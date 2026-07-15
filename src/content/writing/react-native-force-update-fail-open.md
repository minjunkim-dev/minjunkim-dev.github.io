---
title: "강제 업데이트가 앱을 막지 않게: React Native fail-open 상태 모델링"
description: "원격 버전 정책이 실패했을 때 앱 전체를 잠그지 않도록, 확인된 차단과 불확실한 오류를 분리하는 TypeScript 상태 모델과 테스트 전략."
publishedAt: 2026-07-04
tags:
  - TypeScript
  - React Native
  - Reliability
  - State Modeling
draft: false
featured: true
---

강제 업데이트 기능은 오래된 앱이 더 이상 안전하게 동작할 수 없을 때 유용하다. 서버에서 최소 지원 버전을 받고, 현재 버전이 낮으면 스토어 이동 화면을 보여 준다. 정상 경로만 보면 간단하다.

문제는 정책 서버가 느리거나, 응답 형식이 바뀌거나, 일부 네트워크에서 도달할 수 없을 때 시작된다. “확인에 실패했다”를 “업데이트가 필요하다”로 해석하면 버전 정책 시스템의 장애가 정상 앱까지 잠근다. 업데이트를 통해 복구하라는 화면이 뜨지만 스토어의 최신 버전도 같은 원격 장애를 만날 수 있다.

이 글의 기본 정책은 다음과 같다.

> 서버가 **유효한 정책으로 현재 버전의 차단을 확인했을 때만** 막는다. 네트워크·타임아웃·파싱 오류처럼 판단할 수 없는 경우에는 앱을 열되 관측 가능한 fail-open 상태를 남긴다.

보안상 반드시 fail-closed여야 하는 별도 요구사항이 있다면 정책이 달라질 수 있다. 중요한 것은 실패를 Boolean 하나에 섞지 않고 제품의 선택을 타입으로 드러내는 것이다.

## `isUpdateRequired: boolean`이 부족한 이유

다음 함수는 실패의 의미를 잃는다.

```typescript
async function isUpdateRequired(): Promise<boolean> {
  try {
    const response = await fetchPolicy();
    return isOlder(getCurrentVersion(), response.minimumVersion);
  } catch {
    return true;
  }
}
```

`true`가 “정책이 현재 버전을 차단했다”와 “서버에 연결하지 못했다”를 동시에 뜻한다. UI는 둘을 구분할 수 없고, 로그 역시 실제 강제 업데이트와 원격 장애를 같은 사건으로 기록한다.

먼저 원격 확인 결과와 화면 게이트 상태를 나눈다.

```typescript
type Platform = 'ios' | 'android';

type VersionPolicy = {
  minimumVersion: Record<Platform, string>;
  storeURL: Record<Platform, string>;
};

type FailureReason =
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid-payload';

type PolicyResult =
  | { ok: true; policy: VersionPolicy }
  | { ok: false; reason: FailureReason };

type GateState =
  | { kind: 'checking' }
  | { kind: 'open'; mode: 'normal' }
  | { kind: 'open'; mode: 'fail-open'; reason: FailureReason }
  | {
      kind: 'blocked';
      minimumVersion: string;
      storeURL: string;
    };
```

이 모델에는 불가능한 조합이 없다. `blocked`에는 스토어 URL과 확인된 최소 버전이 반드시 있고, `fail-open`에는 차단에 실패한 이유가 반드시 있다. `isLoading`, `hasError`, `isRequired` 같은 Boolean 세 개를 독립적으로 두었을 때 생기는 모순을 타입 단계에서 줄인다.

## 원격 응답은 경계에서 검증하기

TypeScript 타입은 네트워크 응답을 보장하지 않는다. `response.json() as VersionPolicy`는 컴파일러만 안심시킬 뿐 런타임 데이터는 그대로다. 작은 type guard라도 경계에 두어야 한다.

```typescript
const versionPattern = /^\d+\.\d+\.\d+$/;

const allowedStoreHosts: Record<Platform, ReadonlySet<string>> = {
  ios: new Set(['apps.apple.com']),
  android: new Set(['play.google.com']),
};

function isAllowedStoreURL(
  value: unknown,
  platform: Platform,
): value is string {
  if (typeof value !== 'string') return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !allowedStoreHosts[platform].has(url.hostname.toLowerCase())
  ) {
    return false;
  }

  switch (platform) {
    case 'ios':
      return /\/id\d+\/?$/.test(url.pathname);
    case 'android':
      return (
        url.pathname === '/store/apps/details' &&
        Boolean(url.searchParams.get('id'))
      );
  }
}

function isVersionPolicy(value: unknown): value is VersionPolicy {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  const minimum = candidate.minimumVersion as
    | Record<string, unknown>
    | undefined;
  const store = candidate.storeURL as Record<string, unknown> | undefined;

  return Boolean(
    minimum &&
      store &&
      typeof minimum.ios === 'string' &&
      typeof minimum.android === 'string' &&
      versionPattern.test(minimum.ios) &&
      versionPattern.test(minimum.android) &&
      isAllowedStoreURL(store.ios, 'ios') &&
      isAllowedStoreURL(store.android, 'android'),
  );
}
```

`https://` 접두사만 보는 검사는 URL 유효성을 보장하지 않는다. 파싱에 실패하는 문자열, 사용자명과 비밀번호가 들어간 URL, 공식 스토어처럼 보이는 다른 host를 모두 거부해야 한다. 강제 업데이트처럼 원격 값이 외부 앱 열기로 이어지는 경로에서는 플랫폼별 공식 host와 path 형식까지 허용 목록으로 제한하는 편이 안전하다.

예제는 제품이 `major.minor.patch` 숫자 형식을 사용한다는 계약을 명시한다. prerelease, build metadata, 네 자리 버전 등 더 넓은 형식을 지원해야 한다면 검증된 semver 라이브러리나 제품 전용 비교기를 사용해야 한다. 모호한 버전을 억지로 비교해 차단하는 것보다 **정책을 유효하지 않은 것으로 분류하고 fail-open하는 편이 기본 경로를 보존한다.**

## 타임아웃과 취소를 확인 결과로 바꾸기

endpoint는 호출자가 주입한다. 코드에 회사 내부 URL이나 환경별 주소를 넣지 않는다.

```typescript
async function loadPolicy(
  endpoint: string,
  timeoutMs: number,
): Promise<PolicyResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return { ok: false, reason: 'http' };
    }

    const payload: unknown = await response.json();
    if (!isVersionPolicy(payload)) {
      return { ok: false, reason: 'invalid-payload' };
    }

    return { ok: true, policy: payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}
```

타임아웃은 단순 최적화가 아니다. `checking` 상태가 영원히 유지되면 fail-open 정책도 실행되지 못한다. 요청이 끝나는 모든 경로를 `PolicyResult`로 닫아야 상태 머신이 다음 상태로 전이한다.

앱이 background로 전환되거나 해당 루트가 unmount될 때는 바깥 생명주기에서도 요청을 취소할 수 있어야 한다. 실제 구현에서는 외부 `AbortSignal`을 받아 내부 timeout signal과 결합하거나, 정책 로더 인스턴스가 `cancel()`을 제공하도록 구성한다.

## 결정 로직은 순수 함수로 분리하기

원격 요청, 버전 비교, 화면 전환을 한 hook 안에 넣으면 테스트가 네트워크와 React 생명주기에 묶인다. 차단 결정을 순수 함수로 만들면 정책의 핵심을 작은 입력 표로 검증할 수 있다.

```typescript
function parseVersion(version: string): [number, number, number] | null {
  if (!versionPattern.test(version)) return null;

  const parts = version.split('.').map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;

  return [parts[0], parts[1], parts[2]];
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function decideGate(
  currentVersion: string,
  platform: Platform,
  result: PolicyResult,
): GateState {
  if (!result.ok) {
    return {
      kind: 'open',
      mode: 'fail-open',
      reason: result.reason,
    };
  }

  const minimumVersion = result.policy.minimumVersion[platform];
  const comparison = compareVersions(currentVersion, minimumVersion);

  if (comparison === null) {
    return {
      kind: 'open',
      mode: 'fail-open',
      reason: 'invalid-payload',
    };
  }

  if (comparison >= 0) {
    return { kind: 'open', mode: 'normal' };
  }

  return {
    kind: 'blocked',
    minimumVersion,
    storeURL: result.policy.storeURL[platform],
  };
}
```

여기서는 **차단을 만드는 경로가 하나뿐**이다. 유효한 정책이 있고, 현재 버전과 최소 버전을 비교할 수 있으며, 현재 버전이 실제로 낮을 때만 `blocked`가 된다.

로컬의 현재 버전 형식이 잘못된 경우도 기본적으로 fail-open한다. 이 상황은 빌드 파이프라인에서 먼저 실패시켜야 할 구성 오류다. 런타임에서 사용자를 막는 것으로 구성 오류를 숨기지 않는다.

## 화면은 상태를 렌더링하고 부작용은 경계에 둔다

React Native 화면은 `GateState`를 기준으로 단순하게 나뉠 수 있다.

```tsx
function AppGate({ state }: { state: GateState }) {
  switch (state.kind) {
    case 'checking':
      return <LaunchScreen />;

    case 'blocked':
      return (
        <RequiredUpdateScreen
          minimumVersion={state.minimumVersion}
          onPressUpdate={() => openExternalURL(state.storeURL)}
        />
      );

    case 'open':
      return <AppNavigator />;
  }
}
```

`fail-open`은 사용자에게 반드시 오류 화면을 보여 줘야 한다는 뜻이 아니다. 정상 앱으로 들어가되 운영 관측을 위한 이벤트를 남길 수 있다. 이벤트에는 `reason`, 플랫폼, 앱 버전, 정책 요청의 결과 범주 정도만 포함하고 토큰, 사용자 식별 정보, 내부 endpoint는 기록하지 않는다.

스토어 열기 역시 실패할 수 있다. `Linking.canOpenURL`과 `Linking.openURL`의 실패를 처리하고, 사용자가 다시 시도하거나 URL을 복사할 수 있는 대체 경로를 제공한다. “업데이트 필요” 상태를 정확히 계산하는 것과 “스토어 앱을 열 수 있음”은 서로 다른 상태다.

## 캐시된 정책은 가용성과 최신성의 교환이다

마지막으로 성공한 정책을 로컬에 저장하면 일시적 장애 중에도 판단할 수 있다. 하지만 오래된 캐시가 새 최소 버전을 모르거나, 반대로 이미 완화된 차단을 계속 유지할 수 있다.

캐시를 쓴다면 다음 필드를 함께 저장한다.

```typescript
type CachedPolicy = {
  policy: VersionPolicy;
  fetchedAt: string;
  policyVersion: number;
};
```

그리고 정책을 명시한다.

- 캐시 최대 수명은 얼마인가?
- 만료된 캐시는 fail-open 참고 정보인가, 차단 근거인가?
- 서버 정책과 로컬 캐시 중 어느 쪽이 우선하는가?
- 기기 시간이 잘못된 경우 만료를 어떻게 판단하는가?

캐시가 있다고 네트워크 실패가 자동으로 안전해지는 것은 아니다. **차단 근거로 인정할 수 있는 신선도**가 제품 계약에 있어야 한다.

## 테스트 전략: 상태 전이 표를 먼저 고정하기

핵심은 네트워크 mock보다 `decideGate`의 결정 표다. Vitest 예시는 다음과 같다.

```typescript
import { describe, expect, it } from 'vitest';

const policy: VersionPolicy = {
  minimumVersion: {
    ios: '2.4.0',
    android: '3.1.0',
  },
  storeURL: {
    ios: 'https://apps.apple.com/app/id1234567890',
    android: 'https://play.google.com/store/apps/details?id=com.example.app',
  },
};

describe('isAllowedStoreURL', () => {
  it('accepts only the platform store destination shape', () => {
    expect(
      isAllowedStoreURL('https://apps.apple.com/kr/app/example/id1234567890', 'ios'),
    ).toBe(true);
    expect(
      isAllowedStoreURL(
        'https://play.google.com/store/apps/details?id=com.example.app',
        'android',
      ),
    ).toBe(true);
  });

  it.each([
    'https://',
    'https://[bad',
    'https://user:secret@apps.apple.com/app/id1234567890',
    'https://apps.apple.com.evil.example/app/id1234567890',
  ])('rejects an unsafe iOS store URL: %s', (value) => {
    expect(isAllowedStoreURL(value, 'ios')).toBe(false);
  });
});

describe('decideGate', () => {
  it('opens normally when the current version meets the policy', () => {
    expect(decideGate('2.4.0', 'ios', { ok: true, policy })).toEqual({
      kind: 'open',
      mode: 'normal',
    });
  });

  it('blocks only an older version with a confirmed policy', () => {
    expect(decideGate('2.3.9', 'ios', { ok: true, policy })).toEqual({
      kind: 'blocked',
      minimumVersion: '2.4.0',
      storeURL: 'https://apps.apple.com/app/id1234567890',
    });
  });

  it.each(['timeout', 'network', 'http', 'invalid-payload'] as const)(
    'fails open on %s',
    (reason) => {
      expect(decideGate('2.3.9', 'ios', { ok: false, reason })).toEqual({
        kind: 'open',
        mode: 'fail-open',
        reason,
      });
    },
  );
});
```

`loadPolicy`는 fetch를 주입하거나 mock server를 사용해 별도로 테스트한다.

- timeout 시 요청을 abort하고 `timeout`을 반환하는가?
- HTTP 오류를 JSON 파싱 전에 `http`로 분류하는가?
- 응답 body가 객체가 아니거나 플랫폼 필드가 빠지면 `invalid-payload`인가?
- 유효한 iOS/Android 정책을 보존하는가?
- component가 unmount된 뒤 늦은 응답으로 상태를 갱신하지 않는가?

E2E에서는 실제 스토어를 열기보다 외부 URL opener를 주입해 호출 여부를 확인한다. 다음 사용자 경로를 고정하면 회귀를 찾기 쉽다.

1. 정책 서버가 응답하지 않아도 제한 시간 뒤 홈으로 진입한다.
2. 현재 버전이 최소 버전과 같으면 홈으로 진입한다.
3. 현재 버전이 낮고 정책이 유효할 때만 업데이트 화면이 유지된다.
4. Android 정책은 Android URL을, iOS 정책은 iOS URL을 사용한다.
5. 업데이트 화면에서 외부 URL 열기 실패를 복구할 수 있다.

## 마무리

강제 업데이트는 “최신 버전인가?”보다 “어떤 증거가 있을 때 앱을 막을 것인가?”를 결정하는 기능이다. 원격 확인 실패와 확인된 차단을 같은 Boolean으로 표현하면 작은 정책 서비스 장애가 전체 앱 장애로 커질 수 있다.

안전한 기본 구조는 다음과 같다.

1. 원격 응답을 런타임에서 검증한다.
2. 네트워크 결과와 화면 게이트 상태를 분리한다.
3. 유효한 정책이 현재 버전의 미지원 상태를 확인했을 때만 차단한다.
4. 타임아웃·네트워크·파싱 실패는 이유를 남기고 fail-open한다.
5. 결정 로직을 순수 함수로 만들고 상태 전이 표를 테스트한다.

fail-open은 오류를 무시하는 태도가 아니다. **불확실성을 사용자 차단으로 과장하지 않고, 관측 가능한 별도 상태로 보존하는 설계**다.
