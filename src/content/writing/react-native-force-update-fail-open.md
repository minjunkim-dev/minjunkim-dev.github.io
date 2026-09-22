---
title: "React Native 강제 업데이트: 정책 조회 실패와 업데이트 대상을 구분하기"
description: "정책 조회에 실패하면 앱 진입을 허용하고, 최소 지원 버전보다 낮을 때만 차단하는 TypeScript 예제와 테스트 항목."
publishedAt: 2026-07-04
updatedAt: 2026-09-22
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

이 글은 업데이트 정책 조회와 화면 분기를 설명하기 위해 공개용으로 재구성한 예제다. 실서비스 코드나 성능 측정 결과는 아니며, 다음 정책을 가정한다.

> 유효한 정책을 받아 현재 버전이 최소 지원 버전보다 낮다고 확인된 경우에만 차단한다. 네트워크·타임아웃·파싱 오류로 판단할 수 없으면 앱 진입을 허용하고, 실패 이유를 `fail-open` 상태에 담는다.

보안상 정책 확인에 실패해도 차단해야 하는 요구사항이 있다면 fail-closed가 필요할 수 있다. 여기서는 조회 실패와 업데이트 필요 상태를 구분해 화면에서 다르게 처리한다.

## `isUpdateRequired: boolean`이 부족한 이유

다음 함수는 조회에 실패해도 업데이트가 필요하다고 반환한다.

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

먼저 정책 조회 결과와 앱 진입 화면의 상태를 나눈다.

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

`blocked`에는 스토어 URL과 최소 버전이, `fail-open`에는 정책을 확인하지 못한 이유가 필요하다. `isLoading`, `hasError`, `isRequired`를 따로 관리할 때와 달리 로딩과 차단을 동시에 표현하지 않는다. 다만 문자열 값이 실제로 유효한지는 별도 검증이 필요하다.

## 원격 응답은 경계에서 검증하기

TypeScript 타입 선언만으로 네트워크 응답을 검증할 수는 없다. `response.json() as VersionPolicy`를 써도 실제 데이터는 검사되지 않는다. 응답을 사용하기 전에 다음 type guard로 값을 확인한다.

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

예제는 버전을 `major.minor.patch`의 세 숫자로 표기한다고 가정한다. prerelease, build metadata, 네 자리 버전까지 지원해야 한다면 해당 형식을 처리하는 semver 라이브러리나 별도 비교기가 필요하다. 이 예제에서 비교할 수 없는 버전은 오류로 분류하고 앱 진입을 허용한다.

## 타임아웃과 취소를 확인 결과로 바꾸기

정책 조회 주소인 `endpoint`와 제한 시간은 호출자가 전달한다.

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
    if (error instanceof SyntaxError) {
      return { ok: false, reason: 'invalid-payload' };
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}
```

응답을 계속 기다리면 화면도 `checking`에 머무른다. 제한 시간이 지나면 요청을 취소하고 실패 결과를 반환해 앱 진입 여부를 결정하도록 한다.

위 코드에는 앱의 백그라운드 전환이나 컴포넌트 해제에 따른 취소가 없다. 이때도 요청을 취소해야 한다면 외부 `AbortSignal`을 받아 타임아웃과 함께 처리하거나, 정책 로더에 `cancel()`을 추가할 수 있다.

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

현재 앱의 버전 형식이 잘못된 경우도 이 예제에서는 fail-open으로 처리한다. 앱 버전은 빌드 단계에서 형식을 검사해 잘못된 값이 배포되지 않도록 하는 편이 좋다.

## 상태에 따라 화면을 나누기

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

`fail-open`에서도 별도 오류 화면 없이 앱으로 진입할 수 있다. 조회 실패를 추적하려면 이벤트에 `reason`, 플랫폼, 앱 버전, 요청 결과의 종류를 남긴다. 토큰, 사용자 식별 정보, 내부 endpoint는 기록하지 않는다.

스토어 열기 역시 실패할 수 있다. `Linking.canOpenURL`과 `Linking.openURL`의 실패를 처리하고, 사용자가 다시 시도하거나 URL을 복사할 수 있는 대체 경로를 제공한다. “업데이트 필요” 상태를 정확히 계산하는 것과 “스토어 앱을 열 수 있음”은 서로 다른 상태다.

## 캐시된 정책으로 언제까지 차단할 것인가

마지막으로 성공한 정책을 로컬에 저장하면 일시적 장애 중에도 판단할 수 있다. 하지만 오래된 캐시가 새 최소 버전을 모르거나, 반대로 이미 완화된 차단을 계속 유지할 수 있다.

캐시를 쓴다면 다음 필드를 함께 저장한다.

```typescript
type CachedPolicy = {
  policy: VersionPolicy;
  fetchedAt: string;
  policyVersion: number;
};
```

캐시를 적용하기 전에 다음 항목을 정한다.

- 캐시 최대 수명은 얼마인가?
- 만료된 캐시는 fail-open 참고 정보인가, 차단 근거인가?
- 서버 정책과 로컬 캐시 중 어느 쪽이 우선하는가?
- 기기 시간이 잘못된 경우 만료를 어떻게 판단하는가?

저장된 정책이 있다는 이유만으로 계속 차단하면 이미 해제된 제한이 남을 수 있다. 차단 근거로 사용할 수 있는 캐시의 유효 기간을 정해야 한다.

## 테스트: 입력별 앱 진입 여부 확인하기

먼저 `decideGate`에 버전과 조회 결과를 전달해 반환 상태를 확인한다. 아래는 Vitest로 작성한 예제다.

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
- JSON 문법이 잘못됐거나, 응답 body가 객체가 아니거나 플랫폼 필드가 빠지면 `invalid-payload`인가?
- 유효한 iOS/Android 정책을 보존하는가?
- component가 unmount된 뒤 늦은 응답으로 상태를 갱신하지 않는가?

E2E에서는 실제 스토어를 열기보다 외부 URL opener를 주입해 호출 여부를 확인한다. 다음 사용자 경로를 고정하면 회귀를 찾기 쉽다.

1. 정책 서버가 응답하지 않아도 제한 시간 뒤 홈으로 진입한다.
2. 현재 버전이 최소 버전과 같으면 홈으로 진입한다.
3. 현재 버전이 낮고 정책이 유효할 때만 업데이트 화면이 유지된다.
4. Android 정책은 Android URL을, iOS 정책은 iOS URL을 사용한다.
5. 업데이트 화면에서 외부 URL 열기 실패를 복구할 수 있다.

## 마무리

강제 업데이트에서는 최소 지원 버전보다 낮은 경우와 정책을 확인하지 못한 경우를 구분할 필요가 있다. 둘을 같은 Boolean으로 처리하면 정책 서버에 연결하지 못한 사용자까지 업데이트 화면에 갇힐 수 있다.

이 예제의 처리 순서는 다음과 같다.

1. 원격 응답을 런타임에서 검증한다.
2. 정책 조회 결과와 앱 진입 화면의 상태를 분리한다.
3. 유효한 정책의 최소 지원 버전보다 현재 버전이 낮을 때만 차단한다.
4. 타임아웃·네트워크·파싱 실패는 이유를 남기고 fail-open한다.
5. 결정 로직을 순수 함수로 만들고 상태 전이 표를 테스트한다.

fail-open을 선택하더라도 조회 실패 이유는 남겨야 한다. 앱 진입은 허용하되 정책 조회 장애를 확인하고 대응할 수 있어야 하기 때문이다.
