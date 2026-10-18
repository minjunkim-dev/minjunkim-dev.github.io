// Code shown in the article "web-deploy-verify-public-sha256".

// snippet:start manifest
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
// snippet:end manifest

// snippet:start upload-order
function uploadOrder(manifest: ReleaseManifest): string[] {
  const last = ['index.html', MARKER];
  const assets = manifest.files
    .map((file) => file.path)
    .filter((path) => !last.includes(path));
  // 자산을 먼저, HTML을 마지막에 올린다. 이전 자산은 지우지 않는다.
  return [...assets, ...last];
}
// snippet:end upload-order

// snippet:start verify
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
// snippet:end verify

export type { ReleaseManifest, VerifyResult };
export { createManifest, uploadOrder, verifyRelease, MARKER, IMMUTABLE, NO_CACHE };
