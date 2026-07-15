---
title: "앱 시작은 한 번만 일어나지 않는다: race를 멱등한 초기화로 바꾸기"
description: "AppDelegate, Scene, 딥링크가 동시에 초기화를 요구할 때 중복 실행과 부분 상태를 막는 actor 기반 시작 조정기 설계."
publishedAt: 2026-07-13
tags:
  - Swift
  - iOS
  - Concurrency
  - Architecture
draft: false
featured: true
---

앱 시작 코드는 흔히 `didFinishLaunching` 안의 순서도처럼 보인다. 설정을 읽고, 저장소를 열고, 세션을 복원한 다음 첫 화면을 만든다. 이 설명에는 한 가지 중요한 전제가 숨어 있다. **시작이 한 번만 호출되고 끝까지 순서대로 실행된다는 전제**다.

실제 앱에는 진입점이 여럿이다. 앱 델리게이트가 기본 초기화를 시작하는 동안 Scene이 연결될 수 있고, 푸시 알림이나 딥링크가 먼저 도착해 인증 상태를 요구할 수 있다. 백그라운드 작업이나 복구 코드가 같은 의존성을 요청할 수도 있다. 각각이 `initialize()`를 호출하면 단순한 중복 작업을 넘어 서로 다른 부분 상태를 관찰하게 된다.

이 글은 특정 프로젝트의 구현을 옮긴 것이 아니다. 여러 모바일 앱에서 반복되는 시작 문제를 일반화해, **초기화를 하나의 상태 머신으로 만들고 모든 진입점을 같은 결과에 수렴시키는 방법**을 정리한다.

## 시작 race가 만드는 세 가지 실패

가장 알아보기 쉬운 형태는 확인 후 실행하는 코드다.

```swift
final class AppBootstrapper {
    private var isReady = false

    func start() async throws {
        guard !isReady else { return }

        let configuration = try await loadConfiguration()
        try await openDatabase(configuration)
        try await restoreSession()

        isReady = true
    }
}
```

`guard`는 동시 호출을 막지 못한다. 두 Task가 모두 `isReady == false`를 읽고 다음 줄로 진행할 수 있다. 여기서 나타나는 실패는 대체로 세 종류다.

1. **중복 부작용**: 데이터베이스 마이그레이션, 이벤트 구독, 토큰 갱신이 두 번 수행된다.
2. **부분 상태 노출**: 설정은 준비됐지만 세션은 아직인 순간을 다른 진입점이 관찰한다.
3. **실패 정책 충돌**: 한 호출은 성공하고 다른 호출은 실패해, 호출자마다 앱 준비 상태를 다르게 판단한다.

직렬 큐나 actor로 함수를 감싸도 충분하지 않을 수 있다. actor는 저장 프로퍼티 접근을 직렬화하지만, actor 메서드는 `await`에서 재진입될 수 있다. 첫 호출이 네트워크 응답을 기다리는 동안 두 번째 호출이 actor 안으로 들어와 다시 작업을 시작할 수 있다.

핵심은 “동시에 들어오지 못하게 한다”가 아니라 **이미 시작된 작업 자체를 상태로 보관하고 공유하는 것**이다.

## 상태를 `idle`, `running`, `ready`로 나누기

초기화는 Boolean 하나보다 세 상태로 표현하는 편이 정확하다.

- `idle`: 아직 시작하지 않았거나, 재시도 가능한 실패 뒤로 돌아온 상태
- `running(Task)`: 누군가 시작했고 다른 호출자가 기다려야 하는 상태
- `ready(Services)`: 완성된 결과를 즉시 재사용할 수 있는 상태

실행 중인 `Task`를 저장하면 두 번째 호출자는 새 작업을 만들지 않고 같은 결과를 기다릴 수 있다.

```swift
import Foundation

struct AppServices: Sendable, Equatable {
    let sessionID: String?
}

actor StartupCoordinator {
    typealias Builder = @Sendable () async throws -> AppServices

    private enum State {
        case idle
        case running(Task<AppServices, Error>)
        case ready(AppServices)
    }

    private var state: State = .idle
    private let build: Builder

    init(build: @escaping Builder) {
        self.build = build
    }

    func start() async throws -> AppServices {
        switch state {
        case .ready(let services):
            return services

        case .running(let task):
            return try await task.value

        case .idle:
            let task = Task { try await build() }
            state = .running(task)

            do {
                let services = try await task.value
                state = .ready(services)
                return services
            } catch {
                state = .idle
                throw error
            }
        }
    }
}
```

여기서 중요한 순서는 `Task`를 만든 직후, 첫 번째 `await`보다 먼저 `.running(task)`를 기록하는 것이다. actor는 그 지점까지 원자적으로 실행한다. 이후 재진입한 호출은 `.running`을 보고 같은 Task의 값을 기다린다.

성공한 결과도 상태에 저장한다. 준비가 끝난 뒤 들어온 딥링크가 초기화 단계를 다시 밟지 않고 같은 `AppServices`를 받으므로, `start()`는 몇 번 호출해도 같은 의미를 갖는다.

## 실패 뒤에 어떤 상태로 돌아갈 것인가

예제는 모든 오류에서 `.idle`로 돌아간다. 즉 다음 호출이 재시도할 수 있다. 이것이 항상 맞는 정책은 아니다.

설정 파일 손상처럼 재시도로 해결되지 않는 오류라면 별도의 종료 상태가 필요하다.

```swift
private enum State {
    case idle
    case running(Task<AppServices, Error>)
    case ready(AppServices)
    case failed(PermanentStartupError)
}
```

오류를 일시적/영구적으로 분류하지 않은 채 무한 재시도하거나, 반대로 첫 실패를 영구 캐시하면 복구 가능성을 잃는다. 시작 조정기는 작업 순서뿐 아니라 다음 정책도 소유해야 한다.

| 질문 | 가능한 정책 |
| --- | --- |
| 네트워크 실패 뒤 재시도할까? | `.idle`로 복귀하고 사용자 동작이나 백오프로 재시도 |
| 로컬 데이터 형식이 지원되지 않으면? | `.failed`로 고정하고 복구 UI 제공 |
| 한 호출자가 취소되면 공유 작업도 취소할까? | 보통은 공유 작업을 유지하고 해당 대기만 종료 |
| 로그아웃 뒤 다시 만들 수 있어야 할까? | 명시적 `reset()`과 새 세대(generation) 도입 |

특히 취소 정책은 의도적으로 정해야 한다. 앱 전체가 필요로 하는 초기화를 첫 화면 Task의 생명주기에 묶으면, 화면 전환이 공유 작업을 취소할 수 있다. 반대로 어떤 호출자도 취소할 수 없는 작업은 앱 종료 직전까지 불필요하게 남을 수 있다. **작업의 소유자가 화면인지, Scene인지, 프로세스인지**를 먼저 정하면 선택이 쉬워진다.

## 부작용은 완성된 값 뒤에 숨긴다

`StartupCoordinator`가 안전해도 `build()`가 전역 싱글턴을 단계별로 바꾸면 부분 상태가 다시 노출된다.

```swift
// 피하고 싶은 형태
GlobalContainer.shared.configuration = configuration
GlobalContainer.shared.database = database
GlobalContainer.shared.session = session
```

대신 지역 변수에서 모든 의존성을 만든 뒤 마지막에 하나의 값으로 공개한다.

```swift
func buildServices() async throws -> AppServices {
    let configuration = try await loadConfiguration()
    let database = try await openDatabase(using: configuration)
    let session = try await restoreSession(from: database)

    // 필요한 값이 모두 준비된 뒤 한 번에 반환한다.
    return AppServices(sessionID: session?.id)
}
```

이 구조에서는 호출자가 “준비됨”을 관찰하는 순간 필요한 값이 함께 존재한다. 컴파일러가 초기화 완료 전 상태를 표현하기 어렵게 만들수록 런타임 방어 코드도 줄어든다.

## 진입점은 조정기만 호출한다

AppDelegate, SceneDelegate, 딥링크 처리기가 각각 초기화 상세를 알면 시간이 지나며 순서가 다시 갈라진다. 진입점은 같은 조정기를 호출하고, 결과 이후의 화면 전환만 담당하는 편이 낫다.

```swift
@MainActor
final class AppRouter {
    private let startup: StartupCoordinator

    init(startup: StartupCoordinator) {
        self.startup = startup
    }

    func handle(_ route: AppRoute) async {
        do {
            let services = try await startup.start()
            present(route, using: services)
        } catch {
            presentRecovery(for: error)
        }
    }
}
```

이제 “누가 먼저 앱을 깨웠는가”는 준비 결과를 바꾸지 않는다. 시작 이벤트는 여러 개일 수 있지만 준비 작업과 최종 상태는 하나다.

## 테스트 전략: 순서가 아니라 불변식을 검증하기

동시성 테스트에서 특정 스케줄 순서를 기대하면 테스트 자체가 불안정해진다. 대신 아래 불변식을 검증한다.

- 동시에 여러 번 호출해도 builder는 한 번만 실행된다.
- 모든 호출자는 같은 결과를 받는다.
- 성공 뒤 호출은 builder를 다시 실행하지 않는다.
- 일시적 실패 뒤 다음 호출은 재시도한다.
- 영구 실패 정책이 있다면 같은 오류 상태를 유지한다.

Swift Testing으로 첫 두 조건을 검증하는 예시는 다음과 같다.

```swift
import Testing

actor CallCounter {
    private(set) var value = 0

    func increment() {
        value += 1
    }
}

@Test
func concurrentStartsShareOneBuild() async throws {
    let counter = CallCounter()
    let expected = AppServices(sessionID: "fixture-session")

    let coordinator = StartupCoordinator {
        await counter.increment()
        try await Task.sleep(for: .milliseconds(20))
        return expected
    }

    async let first = coordinator.start()
    async let second = coordinator.start()
    async let third = coordinator.start()

    let results = try await [first, second, third]

    #expect(results == [expected, expected, expected])
    #expect(await counter.value == 1)
}
```

재시도는 첫 실행만 실패하는 builder로 확인할 수 있다.

```swift
actor AttemptPlan {
    private var attempt = 0

    func next() throws -> AppServices {
        attempt += 1
        if attempt == 1 {
            throw URLError(.timedOut)
        }
        return AppServices(sessionID: nil)
    }
}

@Test
func transientFailureReturnsToIdle() async throws {
    let plan = AttemptPlan()
    let coordinator = StartupCoordinator {
        try await plan.next()
    }

    await #expect(throws: URLError.self) {
        try await coordinator.start()
    }

    let services = try await coordinator.start()
    #expect(services == AppServices(sessionID: nil))
}
```

단위 테스트만으로 실제 생명주기 결합을 모두 확인할 수는 없다. 통합 테스트에서는 다음 시나리오를 별도로 만든다.

1. cold launch 직후 딥링크 전달
2. Scene 재연결과 세션 복원 동시 발생
3. 초기화 중 백그라운드 전환 후 foreground 복귀
4. 일시적 네트워크 실패 뒤 사용자 재시도

테스트 로그에는 호출 횟수보다 **상태 전이와 generation 식별자**를 남기는 편이 유용하다. 민감한 세션 값이나 내부 URL은 기록하지 않는다.

## 마무리

앱 시작 race는 호출 지점에 `if`를 하나 더 붙여 해결하기 어렵다. 시작을 단발성 함수가 아니라 상태 머신으로 바꾸고, 실행 중인 Task와 완성된 결과를 공유해야 한다.

정리하면 다음 네 가지가 핵심이다.

1. 시작 진입점이 여러 개라는 사실을 설계에 반영한다.
2. `running(Task)`를 상태로 저장해 중복 작업을 합친다.
3. 모든 의존성을 지역에서 완성한 뒤 하나의 값으로 공개한다.
4. 실패, 취소, 재시도 정책을 시작 조정기의 계약으로 명시한다.

이렇게 만든 `start()`는 “한 번만 호출해야 하는 함수”가 아니라 **몇 번 호출되어도 같은 준비 상태로 수렴하는 경계**가 된다.
