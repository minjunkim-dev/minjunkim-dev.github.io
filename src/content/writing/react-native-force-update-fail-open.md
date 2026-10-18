---
title: "정책 서버가 죽어도 앱은 열려야 한다: 라이브 방송 앱의 fail-open 강제 업데이트"
description: "운전 중 듣는 라이브 방송 앱에서 강제 업데이트를 설계한 기록. 정책 조회 실패와 업데이트 대상을 다른 상태로 나누고, 실패하면 진입을 허용한 이유와 결과를 정리한다."
publishedAt: 2026-07-04
updatedAt: 2026-10-18
tags:
  - React Native
  - TypeScript
  - Reliability
  - Production Notes
draft: false
featured: true
---

## 상황

tbn교통방송 앱은 13개 지역 FM 라이브 방송을 듣고 교통 정보를 제보하는 React Native 앱이다. 2025년부터 앱을 다시 만들었고 2026년 5월 28일 iOS·Android에 정식 출시했다. 사용자는 주로 운전 중에 앱을 연다. 앱이 열리지 않으면 방송을 듣지 못하고, 운전 중에 원인을 찾을 수도 없다.

출시를 앞두고 강제 업데이트가 필요했다. 오래된 버전에서 서버 계약이 바뀌면 기능이 조용히 깨지기 때문이다. 서버가 플랫폼별 최소 지원 버전을 알려 주고, 현재 버전이 낮으면 스토어로 안내한다.

이 글의 코드는 같은 판단 구조를 공개용으로 다시 쓴 것이다. 제품 코드를 그대로 옮기지 않았다.

## 문제: Boolean 하나에 두 가지 뜻이 섞인다

처음 떠오르는 구현은 다음과 같다.

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

`true`가 "정책이 이 버전을 막았다"와 "정책 서버에 연결하지 못했다"를 모두 뜻한다. 정책 서버가 느려지거나 응답 형식이 바뀌면 모든 사용자가 업데이트 화면에 갇힌다. 최신 버전으로 업데이트해도 같은 서버 장애를 만나므로 빠져나갈 길이 없다. 로그에서도 실제 강제 업데이트와 서버 장애가 같은 사건으로 남는다.

## 결정: 확인하지 못하면 연다 (fail-open)

선택지는 세 가지였다.

| 선택지 | 정책 서버 장애 때 | 판단 |
|---|---|---|
| fail-closed: 확인 실패도 차단 | 모든 사용자가 앱을 못 연다 | 보안 정책이 반드시 지켜져야 할 때만 맞다. 방송 앱에서는 장애 범위가 너무 크다 |
| 마지막 정책 캐시로 판단 | 캐시가 있으면 판단을 이어 간다 | 캐시 수명, 기기 시간 오류, 해제된 차단이 남는 문제를 함께 풀어야 한다. 1차 출시 범위를 넘는다 |
| **fail-open: 확인 실패는 진입 허용** | 앱은 열리고, 다음 실행에서 다시 확인한다 | 장애가 진입 장애로 번지지 않는다. 실패 이유를 기록해 장애를 따로 감지한다 |

fail-open을 골랐다. 차단은 **유효한 정책을 받았고, 현재 버전이 최소 버전보다 낮다고 확인된 경우에만** 일어난다. 네트워크·timeout·HTTP·형식 오류는 진입을 허용하되 실패 이유를 상태에 담는다.

<figure>
<svg viewBox="0 0 680 300" role="img" aria-label="강제 업데이트 게이트 상태 전이도: checking에서 조회 실패 시 fail-open, 정책 확인 후 버전이 같거나 높으면 normal, 낮으면 blocked" xmlns="http://www.w3.org/2000/svg" font-family="Pretendard, -apple-system, sans-serif">
  <defs><marker id="fo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4d4d4d"/></marker></defs>
  <rect x="20" y="120" width="130" height="56" rx="8" fill="#fafafa" stroke="#171717"/>
  <text x="85" y="145" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">checking</text>
  <text x="85" y="164" text-anchor="middle" font-size="12" fill="#4d4d4d">스플래시 · timeout</text>
  <rect x="270" y="20" width="160" height="56" rx="8" fill="#fff" stroke="#171717"/>
  <text x="350" y="45" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">open · fail-open</text>
  <text x="350" y="64" text-anchor="middle" font-size="12" fill="#4d4d4d">실패 이유 기록</text>
  <rect x="270" y="120" width="160" height="56" rx="8" fill="#fff" stroke="#171717"/>
  <text x="350" y="145" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">open · normal</text>
  <text x="350" y="164" text-anchor="middle" font-size="12" fill="#4d4d4d">현재 ≥ 최소 버전</text>
  <rect x="270" y="220" width="160" height="56" rx="8" fill="#fff" stroke="#171717" stroke-width="2"/>
  <text x="350" y="245" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">blocked</text>
  <text x="350" y="264" text-anchor="middle" font-size="12" fill="#4d4d4d">현재 &lt; 최소 버전</text>
  <rect x="520" y="70" width="140" height="56" rx="8" fill="#fafafa" stroke="#171717"/>
  <text x="590" y="95" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">권한 요청</text>
  <text x="590" y="114" text-anchor="middle" font-size="12" fill="#4d4d4d">→ 홈</text>
  <path d="M150,135 L266,52" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#fo-arrow)"/>
  <text x="262" y="30" text-anchor="end" font-size="12" fill="#4d4d4d">timeout · network</text>
  <text x="262" y="46" text-anchor="end" font-size="12" fill="#4d4d4d">http · invalid-payload</text>
  <path d="M150,148 L266,148" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#fo-arrow)"/>
  <text x="208" y="141" text-anchor="middle" font-size="12" fill="#4d4d4d">정책 확인</text>
  <path d="M150,162 L266,244" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#fo-arrow)"/>
  <text x="262" y="262" text-anchor="end" font-size="12" fill="#4d4d4d">정책 확인 + 버전 낮음</text>
  <path d="M430,48 L516,90" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#fo-arrow)"/>
  <path d="M430,148 L516,106" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#fo-arrow)"/>
  <text x="440" y="250" font-size="12" fill="#4d4d4d">스토어 안내에 머문다</text>
</svg>
<figcaption>유효한 정책이 차단을 확인한 경우에만 스토어 안내로 간다. 권한 요청은 업데이트 판정 뒤로 옮겼다.</figcaption>
</figure>

## 구현 1: 조회 결과와 화면 상태를 나눈다

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
  | {
      kind: 'open';
      mode: 'fail-open';
      reason: FailureReason | 'invalid-app-version';
    }
  | {
      kind: 'blocked';
      minimumVersion: string;
      storeURL: string;
    };
```

`isLoading`, `hasError`, `isRequired`를 따로 두면 "로딩 중이면서 차단" 같은 불가능한 조합이 생긴다. 하나의 합 타입으로 두면 화면이 받을 수 있는 상태가 4개로 고정된다.

## 구현 2: 모든 실패를 이유가 붙은 결과로 바꾼다

정책 조회는 예외를 밖으로 던지지 않는다. timeout, 연결 실패, HTTP 오류, 형식 오류를 각각의 이유로 바꿔 돌려준다. 응답 형식 검증(`isVersionPolicy`)은 부록에 있다.

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

timeout 상한이 없으면 스플래시가 `checking`에 머문다. 제한 시간이 지나면 요청을 취소하고 `timeout`으로 판정해 진입 여부를 바로 결정한다.

## 구현 3: 차단 결정은 순수 함수 하나에 둔다

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

  if (!parseVersion(currentVersion)) {
    return {
      kind: 'open',
      mode: 'fail-open',
      reason: 'invalid-app-version',
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

판정 함수를 네트워크와 React 생명주기에서 떼어 놓았다. 그래서 정책 전체를 입력 표 하나로 테스트할 수 있다. 비교할 수 없는 버전도 차단하지 않고 fail-open으로 보낸다. 앱 자신의 버전이 잘못되었으면 서버 응답 오류와 구분해 `invalid-app-version`으로 남긴다. 앱 자신의 버전 형식은 빌드 단계에서 검사해 잘못된 값이 배포되지 않게 한다.

## 구현 4: 시작 순서를 고정한다

시작 흐름은 스플래시 → 정책 조회(timeout 상한) → 판정 → 권한 요청 → 홈 순서로 고정했다. 차단될 버전에서 위치·알림 권한을 먼저 묻지 않으려고 권한 요청을 판정 뒤로 옮겼다.

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

`fail-open` 상태는 오류 화면 없이 앱으로 들어간다. 대신 실패 이유, 플랫폼, 앱 버전을 이벤트로 남긴다. 토큰, 사용자 식별 정보, 내부 endpoint는 남기지 않는다.

## 결과

- 2026년 5월 28일 iOS·Android 정식 출시. 출시 뒤 제보전화 번호 매핑 오류를 찾아 패치했고, 이 게이트로 강제 업데이트를 걸어 구버전 사용자를 패치 버전으로 옮겼다.
- 2026년 9월 말 활성 사용자의 98% 이상이 최신 버전을 사용했다(Android 98.5%, iOS 100%, 스토어·Firebase 콘솔 조회값).
- 정책 서버 장애가 실제로 몇 번 있었는지는 측정하지 않았다. fail-open은 장애가 나도 진입 장애로 번지지 않게 하려는 설계다.

## 테스트

판정 함수는 상태 전이 표로 고정한다. 아래는 Vitest 예제다.

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

  it('fails open on an invalid app version', () => {
    expect(decideGate('2.4', 'ios', { ok: true, policy })).toEqual({
      kind: 'open',
      mode: 'fail-open',
      reason: 'invalid-app-version',
    });
  });
});
```

E2E에서는 실제 스토어를 열지 않고 외부 URL opener를 주입해 다음 경로를 고정한다.

1. 정책 서버가 응답하지 않아도 제한 시간 뒤 홈으로 들어간다.
2. 현재 버전이 최소 버전과 같으면 홈으로 들어간다.
3. 현재 버전이 낮고 정책이 유효할 때만 업데이트 화면에 머문다.
4. 스토어 열기에 실패해도 다시 시도할 수 있다.

## 의견: 언제 이 방법을 쓰지 말아야 하는가

- **보안 패치를 반드시 강제해야 할 때.** 예를 들어 알려진 취약점이 있는 버전이 결제나 본인인증을 처리한다면 fail-closed가 맞다. 이때는 차단 화면에 고객센터·재시도 경로를 함께 둔다.
- **정책 서버가 앱 API와 같은 장애 범위에 있을 때.** 정책 서버만 따로 죽는 일이 드물다면 fail-open의 이득도 작다. 정책은 CDN 같은 정적 경로에 두는 편이 낫다.
- **다시 한다면** 마지막 성공 정책을 짧은 수명으로 캐시해, "정책 확인 실패 + 캐시상 차단 대상"을 별도 상태로 다루겠다. 그리고 fail-open 비율을 대시보드에 올려 정책 서버 장애를 사용자 신고 전에 알 수 있게 하겠다.

## 부록: 원격 응답과 스토어 URL 검증

TypeScript 타입은 네트워크 응답을 검증하지 않는다. 스토어 URL은 외부 앱 열기로 이어지므로 플랫폼별 공식 host와 path 형식만 허용한다. `https://` 접두사 검사만으로는 파싱 실패 문자열, 계정 정보가 들어간 URL, 공식 스토어처럼 보이는 다른 host를 막지 못한다.

검증에는 `URL` 대신 정규식을 쓴다. 이 앱이 쓰는 React Native 0.79의 내장 `URL`은 `protocol`, `hostname` 같은 getter를 구현하지 않아 읽으면 예외를 던진다. 그 예외는 `loadPolicy`에서 `network`로 분류되어 게이트가 차단하지 못한다. Node의 `URL`은 getter를 모두 구현하므로 Node 테스트로는 이 문제를 잡지 못한다.

```typescript
const versionPattern = /^\d+\.\d+\.\d+$/;

const allowedStoreHosts: Record<Platform, ReadonlySet<string>> = {
  ios: new Set(['apps.apple.com']),
  android: new Set(['play.google.com']),
};

const storeURLPattern =
  /^https:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/;

function isAllowedStoreURL(
  value: unknown,
  platform: Platform,
): value is string {
  if (typeof value !== 'string') return false;

  const match = storeURLPattern.exec(value);
  if (!match) return false;

  const host = match[1].toLowerCase();
  const path = match[2] ?? '';
  const query = match[3] ?? '';
  const isAllowedHost = Array.from(allowedStoreHosts[platform]).some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
  if (!isAllowedHost) return false;

  switch (platform) {
    case 'ios':
      return /\/id\d+\/?$/.test(path);
    case 'android':
      return (
        path === '/store/apps/details' && /(?:^|&)id=[^&]+/.test(query)
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

검증 테스트는 정상 URL과 함께 깨진 URL, 계정 정보가 든 URL, 비슷한 host를 넣는다.

```typescript
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
    'https://apps.apple.com:8443/app/id1234567890',
  ])('rejects an unsafe iOS store URL: %s', (value) => {
    expect(isAllowedStoreURL(value, 'ios')).toBe(false);
  });
});
```

버전은 `major.minor.patch` 세 숫자라고 가정한다. prerelease까지 다뤄야 한다면 semver 비교기가 필요하다. 네 자리 버전은 semver 형식이 아니므로 별도 비교 규칙을 정해야 한다.

같은 판단을 Swift로 옮긴 `VersionGate`는 [ios-production-patterns](https://github.com/minjunkim-dev/ios-production-patterns)에 있다.
