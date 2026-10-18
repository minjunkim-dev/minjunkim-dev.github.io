---
title: "HTTP 200은 배포 성공이 아니다: 공개 응답의 SHA-256으로 웹 배포 검증하기"
description: "웹 프론트 3종의 운영 배포에서 '업로드 완료'와 'HTTP 200'을 성공 기준에서 뺐다. 사용자가 받는 파일이 빌드한 파일과 같을 때만 성공으로 기록하도록 바꾼 이유, 구현, 결과와 한계를 정리한다."
publishedAt: 2026-10-18
tags:
  - CI/CD
  - AWS
  - Reliability
  - Production Notes
draft: false
featured: true
---

**요약**

- 업로드가 끝나고 HTTP 200이 와도, 사용자가 이전 화면을 받을 수 있었다. CDN 캐시와 SPA 대체 응답 때문이다.
- 성공 기준을 "사용자가 받는 파일이 빌드한 파일과 같다"로 바꿨다. 공개 URL에서 받은 HTML·JS·CSS의 SHA-256을 빌드 때 만든 manifest와 비교한다.
- 공개 URL 3개의 응답 9개가 manifest와 일치했고, 운영 검증 전용 실행 3회 뒤 실제 운영 배포에 적용했다.

## 상황

MyD는 개인 데이터 지갑 앱이다. 앱 안의 WebView 화면, 관리자 웹, B2B 웹, 이렇게 웹 프론트 3종이 따로 배포된다. 운영 환경은 CDN(CloudFront) 뒤의 비공개 객체 저장소(S3, OAC)에서 정적 파일을 내보내고, 개발 환경은 사내 웹 서버(NGINX)에서 내보낸다.

2026년 8~10월에 앱 업무와 병행하면서 이 배포를 다시 만들었다. 같은 시기에 CI도 Jenkins에서 GitLab CI로 옮겼다. 두 곳에서 같은 기준으로 배포하려면 "무엇을 하면 배포가 성공한 것인가"를 먼저 정해야 했다.

## 문제: 성공 신호가 결과를 증명하지 못한다

기존 배포는 두 가지 신호로 성공을 판정했다.

1. 업로드 명령이 오류 없이 끝났다.
2. 배포 뒤 사이트 주소에 요청하면 HTTP 200이 온다.

두 신호 모두 "사용자가 새 버전을 받는다"를 증명하지 못한다.

- **CDN 캐시.** 저장소의 파일이 바뀌어도, 캐시 무효화가 끝나기 전에는 이전 HTML이 200으로 나간다.
- **SPA 대체 응답.** 단일 페이지 앱은 없는 경로에도 `index.html`을 200으로 돌려준다. 새 HTML이 참조하는 JS가 아직 없어도, 그 요청은 HTML 본문과 함께 200으로 성공한다.
- **환경 혼동.** 개발과 운영 Job의 경계가 약했다. 어떤 커밋이 어느 환경에 나갔는지 산출물만 보고 알 수 없었다.

결과적으로 사용자가 이전 화면을 받아도 배포는 성공으로 기록될 수 있었다.

## 결정: 성공의 정의를 바꾼다

성공 기준을 "명령이 끝났다"에서 "공개 URL에서 받은 파일이 우리가 빌드한 파일과 바이트 단위로 같다"로 바꿨다.

다른 신호와 비교하면 이렇다.

| 신호 | 증명하는 것 | 증명하지 못하는 것 |
|---|---|---|
| 업로드 명령 종료 | 저장소에 파일이 들어갔다 | CDN이 그 파일을 내보낸다 |
| HTTP 200 | 서버가 무언가를 응답했다 | 그 무언가가 새 버전이다 |
| 브라우저 E2E 테스트 | 기능이 동작한다 | 어떤 빌드가 나가 있는지(느리고 불안정함) |
| **공개 응답의 SHA-256** | 사용자가 받는 파일 = 빌드 산출물 | 기능이 동작한다 |

해시 비교는 "어떤 빌드가 나가 있는가"라는 질문에만 답한다. 그 질문에는 정확히 답한다. 기능 검증은 별도 관문으로 남긴다.

<figure>
<div class="figure-scroll">
<svg viewBox="0 0 660 300" role="img" aria-label="배포 검증 흐름: 빌드에서 manifest를 만들고, 자산·HTML·식별 파일 순서로 올리고, 캐시 무효화 완료를 기다린 뒤, 공개 URL에서 받은 파일의 SHA-256을 manifest와 비교해 모두 같을 때만 검증 기록을 남긴다" xmlns="http://www.w3.org/2000/svg" font-family="Pretendard, -apple-system, sans-serif">
  <defs><marker id="dv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4d4d4d"/></marker></defs>
  <rect x="20" y="24" width="160" height="62" rx="8" fill="#fafafa" stroke="#171717"/>
  <text x="100" y="50" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">빌드</text>
  <text x="100" y="70" text-anchor="middle" font-size="12" fill="#4d4d4d">파일별 SHA-256 manifest</text>
  <rect x="240" y="24" width="170" height="62" rx="8" fill="#fff" stroke="#171717"/>
  <text x="325" y="50" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">업로드</text>
  <text x="325" y="70" text-anchor="middle" font-size="12" fill="#4d4d4d">자산 → HTML → 식별 파일</text>
  <rect x="470" y="24" width="170" height="62" rx="8" fill="#fff" stroke="#171717"/>
  <text x="555" y="50" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">캐시 무효화</text>
  <text x="555" y="70" text-anchor="middle" font-size="12" fill="#4d4d4d">완료까지 대기</text>
  <rect x="470" y="160" width="170" height="62" rx="8" fill="#fff" stroke="#171717" stroke-width="2"/>
  <text x="555" y="186" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">공개 URL에서 받기</text>
  <text x="555" y="206" text-anchor="middle" font-size="12" fill="#4d4d4d">식별 파일·HTML·JS·CSS</text>
  <rect x="240" y="160" width="170" height="62" rx="8" fill="#fff" stroke="#171717" stroke-width="2"/>
  <text x="325" y="186" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">SHA-256 비교</text>
  <text x="325" y="206" text-anchor="middle" font-size="12" fill="#4d4d4d">manifest와 바이트 단위</text>
  <rect x="20" y="120" width="140" height="56" rx="8" fill="#fafafa" stroke="#171717"/>
  <text x="90" y="145" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">검증 기록</text>
  <text x="90" y="164" text-anchor="middle" font-size="12" fill="#4d4d4d">복구 대상이 된다</text>
  <rect x="20" y="214" width="140" height="56" rx="8" fill="#fff" stroke="#171717"/>
  <text x="90" y="239" text-anchor="middle" font-size="15" font-weight="700" fill="#171717">실패</text>
  <text x="90" y="258" text-anchor="middle" font-size="12" fill="#4d4d4d">200이어도 불일치면</text>
  <path d="M180,55 L236,55" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#dv-arrow)"/>
  <path d="M410,55 L466,55" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#dv-arrow)"/>
  <path d="M555,86 L555,156" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#dv-arrow)"/>
  <path d="M470,191 L414,191" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#dv-arrow)"/>
  <path d="M240,180 L164,152" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#dv-arrow)"/>
  <text x="200" y="152" text-anchor="middle" font-size="12" fill="#4d4d4d">전부 일치</text>
  <path d="M240,204 L164,240" fill="none" stroke="#4d4d4d" stroke-width="1.5" marker-end="url(#dv-arrow)"/>
  <text x="228" y="250" text-anchor="start" font-size="12" fill="#4d4d4d">하나라도 다름</text>
</svg>
</div>
<figcaption>성공 기록은 마지막 비교를 통과해야만 남는다. 업로드와 캐시 무효화가 끝난 것은 성공이 아니라 검증을 시작할 조건이다.</figcaption>
</figure>

## 구현 1: 빌드할 때 manifest를 만든다

비교하려면 "원래 무엇이어야 하는가"가 필요하다. 빌드 직후 모든 파일의 경로, 크기, SHA-256을 manifest로 남긴다. 아래 예제는 실제 배포 스크립트의 구조를 TypeScript로 옮겨 줄인 것이다.

```typescript
type ManifestEntry = {
  path: string;
  bytes: number;
  sha256: string;
  cacheControl: string;
};
type ReleaseManifest = {
  releaseId: string;
  sourceCommit: string;
  files: ManifestEntry[];
};

const MARKER = '__deployment.json';
const IMMUTABLE = 'public,max-age=31536000,immutable';
const NO_CACHE = 'no-cache,no-store,must-revalidate';

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function createManifest(
  releaseId: string,
  sourceCommit: string,
  build: Map<string, Uint8Array<ArrayBuffer>>,
): Promise<ReleaseManifest> {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('sourceCommit must be a full commit SHA');
  }
  if (!build.has('index.html')) throw new Error('index.html is missing');

  // 공개 URL에서 지금 나가 있는 릴리스를 읽을 수 있게 식별 파일을 넣는다.
  const marker = JSON.stringify({ releaseId, sourceCommit }) + '\n';
  const files = new Map(build).set(MARKER, new TextEncoder().encode(marker));

  const entries: ManifestEntry[] = [];
  const sorted = [...files].sort(([a], [b]) => a.localeCompare(b));
  for (const [path, bytes] of sorted) {
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`invalid path: ${path}`);
    }
    // 이름에 내용 해시가 들어간 자산만 오래 캐시한다.
    const hashedName = /[.-][A-Za-z0-9_]{8,}\.(?:js|css)$/.test(path);
    entries.push({
      path,
      bytes: bytes.length,
      sha256: await sha256Hex(bytes),
      cacheControl: hashedName ? IMMUTABLE : NO_CACHE,
    });
  }
  return { releaseId, sourceCommit, files: entries };
}
```

두 가지를 함께 정한다.

- **배포 식별 파일.** 릴리스 ID와 소스 커밋을 담은 작은 JSON을 산출물에 넣는다. 공개 URL에서 이 파일을 받아 보면 "지금 어떤 릴리스가 나가 있는가"를 바로 알 수 있다. 이 파일도 manifest에 들어가므로 같은 방식으로 검증된다.
- **캐시 규칙.** 이름에 내용 해시가 들어간 JS·CSS는 1년 동안 캐시해도 안전하다. 내용이 바뀌면 이름도 바뀐다. HTML과 식별 파일은 매번 다시 받게 한다. 정규식은 쓰는 빌드 도구의 파일 이름 규칙에 맞춘다.

운영 Job은 40자리 전체 커밋 해시를 받아야만 빌드한다. 브랜치 이름은 시간이 지나면 다른 커밋을 가리키기 때문이다.

## 구현 2: 올리는 순서를 고정한다

```typescript
function uploadOrder(manifest: ReleaseManifest): string[] {
  const last = ['index.html', MARKER];
  const assets = manifest.files
    .map((file) => file.path)
    .filter((path) => !last.includes(path));
  // 자산을 먼저, HTML을 마지막에 올린다. 이전 자산은 지우지 않는다.
  return [...assets, ...last];
}
```

순서가 중요한 이유는 HTML이 자산을 참조하기 때문이다.

- 자산을 먼저 올린다. 그 사이에 이전 HTML을 받은 사용자는 이전 자산을 그대로 받는다.
- HTML을 마지막에 바꾼다. 새 HTML이 나가는 순간 새 자산은 이미 있다.
- 이전 자산은 지우지 않는다. 이미 열려 있는 화면과 복구할 릴리스가 그 자산을 참조한다.

업로드가 하나라도 실패하면 HTML을 올리지 않고 멈춘다. 그다음 CDN 캐시를 무효화하고, 무효화가 완료될 때까지 기다린 뒤에 검증을 시작한다.

## 구현 3: 공개 응답을 받아 해시로 비교한다

```typescript
type VerifyFailure =
  | { kind: 'network'; path: string }
  | { kind: 'redirect'; path: string; host: string }
  | { kind: 'http'; path: string; status: number }
  | { kind: 'mismatch'; path: string }
  | { kind: 'unknown-asset'; ref: string }
  | { kind: 'no-entrypoint' };

type VerifyResult =
  | { ok: true; checked: string[] }
  | { ok: false; failure: VerifyFailure };

// 사이트가 origin 루트(https://host/)에 배포된다고 가정한다.
async function verifyRelease(
  origin: string,
  manifest: ReleaseManifest,
  fetchFn: typeof fetch = fetch,
): Promise<VerifyResult> {
  const base = new URL(origin);
  const expected = new Map(manifest.files.map((f) => [f.path, f.sha256]));
  const checked: string[] = [];

  async function read(path: string): Promise<string | VerifyFailure> {
    const requested = new URL(path, base);
    let response: Response;
    try {
      response = await fetchFn(requested, { cache: 'no-store' });
    } catch {
      return { kind: 'network', path };
    }
    const host = new URL(response.url || requested.href).host;
    if (host !== base.host) return { kind: 'redirect', path, host };
    if (!response.ok) return { kind: 'http', path, status: response.status };

    const body = new Uint8Array(await response.arrayBuffer());
    // 200이어도 내용이 다르면 실패다.
    // 캐시된 이전 HTML과 SPA 대체 응답이 여기서 걸린다.
    if ((await sha256Hex(body)) !== expected.get(path)) {
      return { kind: 'mismatch', path };
    }
    checked.push(path);
    return new TextDecoder().decode(body);
  }

  const marker = await read(MARKER);
  if (typeof marker !== 'string') return { ok: false, failure: marker };
  const html = await read('index.html');
  if (typeof html !== 'string') return { ok: false, failure: html };

  // HTML이 실제로 참조하는 같은 출처의 JS·CSS만 따라간다.
  const assets = new Set<string>();
  for (const [, ref] of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    let path: string;
    try {
      const url = new URL(ref, base);
      if (url.host !== base.host) continue;
      if (!/\.(?:js|css)$/.test(url.pathname)) continue;
      path = decodeURIComponent(url.pathname).replace(/^\//, '');
    } catch {
      return { ok: false, failure: { kind: 'unknown-asset', ref } };
    }
    if (!expected.has(path)) {
      return { ok: false, failure: { kind: 'unknown-asset', ref } };
    }
    assets.add(path);
  }
  if (![...assets].some((path) => path.endsWith('.js'))) {
    return { ok: false, failure: { kind: 'no-entrypoint' } };
  }

  for (const path of [...assets].sort()) {
    const result = await read(path);
    if (typeof result !== 'string') return { ok: false, failure: result };
  }
  return { ok: true, checked };
}
```

검증은 사용자와 같은 경로로 파일을 받는다. 저장소를 직접 읽지 않고 공개 URL에 요청한다.

1. 식별 파일과 `index.html`을 받아 해시를 비교한다. 캐시된 이전 HTML은 여기서 `mismatch`로 걸린다.
2. HTML이 실제로 참조하는 같은 출처의 JS·CSS를 찾는다. manifest에 없는 파일을 참조하면 실패다. JS 진입점이 하나도 없어도 실패다.
3. 그 JS·CSS를 받아 해시를 비교한다. 자산이 없어서 SPA가 `index.html`을 200으로 돌려준 경우도, 본문 해시가 다르므로 `mismatch`로 걸린다.
4. 다른 호스트로 리다이렉트되면 실패다. 로그인 페이지 같은 곳으로 튕긴 200을 성공으로 오인하지 않는다.

이 함수는 예외를 던지지 않고, 실패마다 이유가 붙은 결과를 돌려준다. CI 로그에 "어느 파일이 왜 실패했는가"가 남아야 다음 조치를 정할 수 있다.

## 구현 4: 검증한 것만 복구 대상으로 삼는다

해시 비교를 통과해야만 검증 기록을 산출물과 함께 보관한다. 이 기록이 운영 규칙과 연결된다.

- **verify와 deploy를 나눈다.** 기본 실행은 verify다. 빌드·파일 검사·산출물 보관까지만 하고 운영 저장소는 건드리지 않는다. deploy는 같은 커밋으로 다시 실행하고, 대상 URL과 커밋을 확인한 사람이 승인해야 진행한다.
- **복구는 다시 빌드하지 않는다.** 검증 기록이 있는 보관 산출물만 복구 대상이다. 파일 해시를 다시 확인한 뒤, 신규 배포와 같은 업로드·무효화·공개 응답 검증을 거친다.
- **운영 Job은 사람만 시작한다.** webhook 실행은 코드에서 거부한다. 실행 시간은 45분으로 제한하고, 같은 서비스의 배포는 잠금으로 직렬화한다.

verify와 deploy는 각각 빌드하므로 두 빌드가 바이트 단위로 같다는 보장은 없다. 그래서 검증 대상은 항상 "그 실행에서 실제로 올린 산출물"이다.

## 결과

| 단계 | 결과 | 측정 조건 |
|---|---|---|
| 개발 환경 | 3개 Job 수동 배포 성공. 서버의 배포 파일 484개 해시 일치 | 개발 서버의 파일 전체를 manifest와 대조 |
| 공개 응답 | 3개 URL의 HTML·JS·CSS 응답 9개가 manifest와 일치 | 공개 URL에서 받은 본문의 SHA-256 |
| 운영 | 검증 전용 실행 3회 성공 뒤 실제 운영 배포에 적용 | verify 실행은 운영 저장소를 바꾸지 않음 |
| 이전 | 같은 기준을 GitLab CI의 배포·검증 job으로 옮김 | 운영 job은 수동 실행 |

배포 스크립트의 테스트는 AWS 호출을 가짜로 바꿔서 실패 경로를 고정했다. 변조된 산출물, 다른 계정·다른 CDN 대상, 업로드 순서, 자산 업로드 실패 시 HTML 미반영, 무효화 완료 대기, SPA 대체 응답 거부를 검사한다. 이 테스트는 실제 AWS 권한이나 운영 성공을 증명하지 않는다. 그것은 위의 실제 실행 결과로 확인했다.

## 의견: 한계와 쓰지 말아야 할 때

- **해시는 "같은 파일"만 증명한다.** 로그인이 되는지, 화면이 동작하는지는 증명하지 않는다. 기능 검증은 별도 관문이다.
- **응답이 매번 바뀌면 쓸 수 없다.** 서버 렌더링이나 요청마다 nonce를 넣는 HTML은 해시가 매번 달라진다. 그때는 식별 파일이나 응답 헤더의 릴리스 ID만 비교하는 쪽으로 기준을 낮춰야 한다.
- **한 위치에서 본 결과다.** 검증은 한 곳에서 요청한다. 모든 CDN 엣지가 같은 파일을 내보낸다는 증명은 아니다. 무효화 완료를 기다리는 것으로 그 위험을 줄였을 뿐이다.
- **이전 자산은 계속 쌓인다.** 복구 가능성을 위해 지우지 않았다. 보관 기간과 정리 정책은 정상 복구 버전을 확보한 뒤 따로 정하기로 했다.

다시 한다면 검증 기록을 처음부터 복구 조건으로 묶겠다. 이번에는 새 파이프라인으로 검증된 운영 배포가 생기기 전까지 복구 대상이 하나도 없었다. "성공을 확인하는 방법"이 생겨야 "되돌릴 곳"도 생긴다.
