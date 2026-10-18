import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createManifest, IMMUTABLE, MARKER, NO_CACHE, uploadOrder, verifyRelease } from './release.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const commit = 'a'.repeat(40);
const html =
  '<!doctype html><link rel="stylesheet" href="/assets/index-AbCd1234.css"><script type="module" src="/assets/index-Ef56Gh78.js"></script><a href="https://cdn.example.org/x.js">x</a>';
const build = new Map([
  ['index.html', enc(html)],
  ['assets/index-AbCd1234.css', enc('body{}')],
  ['assets/index-Ef56Gh78.js', enc('console.log(1)')],
  ['favicon.ico', enc('ico')],
]);
const origin = 'https://web.example.com/';
const markerFor = (releaseId: string) => enc(JSON.stringify({ releaseId, sourceCommit: commit }) + '\n');

describe('createManifest', () => {
  it('rejects a short commit and path traversal', async () => {
    await assert.rejects(createManifest('r1', 'abc', build));
    await assert.rejects(createManifest('r1', commit, new Map([['../x', enc('x')], ['index.html', enc('h')]])));
  });

  it('adds the marker and caches only hashed assets', async () => {
    const manifest = await createManifest('r1', commit, build);
    const byPath = Object.fromEntries(manifest.files.map((f) => [f.path, f]));
    assert.ok(byPath[MARKER]);
    assert.equal(byPath['assets/index-Ef56Gh78.js'].cacheControl, IMMUTABLE);
    assert.equal(byPath['index.html'].cacheControl, NO_CACHE);
    assert.equal(byPath['favicon.ico'].cacheControl, NO_CACHE);
  });
});

describe('uploadOrder', () => {
  it('uploads every file once, with HTML and the marker last', async () => {
    const manifest = await createManifest('r1', commit, build);
    const order = uploadOrder(manifest);
    assert.deepEqual(order.slice(-2), ['index.html', MARKER]);
    assert.equal(order.length, manifest.files.length);
  });
});

describe('verifyRelease', async () => {
  const manifest = await createManifest('r1', commit, build);
  const served = new Map([...build, [MARKER, markerFor('r1')]]);
  type Override = 'throw' | { redirect?: string; status?: number; body?: string };
  // Unknown paths get index.html with 200, like an SPA fallback.
  const site = (overrides: Record<string, Override> = {}): typeof fetch => async (input) => {
    const path = new URL(String(input)).pathname.replace(/^\//, '');
    const o = overrides[path];
    if (o === 'throw') throw new TypeError('offline');
    if (o?.redirect) return Object.defineProperty(new Response('x'), 'url', { value: o.redirect });
    if (o?.status) return new Response('', { status: o.status });
    if (o?.body !== undefined) return new Response(o.body);
    return new Response(served.get(path) ?? served.get('index.html'));
  };

  const cases: Array<[string, typeof fetch, (r: Awaited<ReturnType<typeof verifyRelease>>) => boolean]> = [
    ['all good', site(), (r) => r.ok && r.checked.length === 4],
    ['stale html from cache', site({ 'index.html': { body: '<!doctype html><script src="/assets/old-11111111.js"></script>' } }),
      (r) => !r.ok && r.failure.kind === 'mismatch' && 'path' in r.failure && r.failure.path === 'index.html'],
    ['spa fallback for asset', site({ 'assets/index-Ef56Gh78.js': { body: html } }),
      (r) => !r.ok && r.failure.kind === 'mismatch' && 'path' in r.failure && r.failure.path === 'assets/index-Ef56Gh78.js'],
    ['asset 404', site({ 'assets/index-AbCd1234.css': { status: 404 } }),
      (r) => !r.ok && r.failure.kind === 'http' && r.failure.status === 404],
    ['network error', site({ [MARKER]: 'throw' }), (r) => !r.ok && r.failure.kind === 'network'],
    ['redirect to another host', site({ [MARKER]: { redirect: 'https://login.example.net/' } }),
      (r) => !r.ok && r.failure.kind === 'redirect'],
    ['old marker', site({ [MARKER]: { body: '{"releaseId":"r0"}\n' } }),
      (r) => !r.ok && r.failure.kind === 'mismatch' && 'path' in r.failure && r.failure.path === MARKER],
  ];
  for (const [name, fetchStub, expected] of cases) {
    it(name, async () => {
      const result = await verifyRelease(origin, manifest, fetchStub);
      assert.ok(expected(result), JSON.stringify(result));
    });
  }

  for (const [name, page, kind] of [
    ['unknown asset', '<script src="/assets/missing-99999999.js"></script>', 'unknown-asset'],
    ['malformed escape', '<script src="/assets/%E0%A4%A.js"></script>', 'unknown-asset'],
    ['no js entrypoint', '<link rel="stylesheet" href="/assets/index-AbCd1234.css">', 'no-entrypoint'],
  ] as const) {
    it(name, async () => {
      const files = new Map(build).set('index.html', enc(page));
      const m = await createManifest('r2', commit, files);
      const s = new Map([...files, [MARKER, markerFor('r2')]]);
      const stub: typeof fetch = async (input) =>
        new Response(s.get(new URL(String(input)).pathname.replace(/^\//, '')) ?? s.get('index.html'));
      const r = await verifyRelease(origin, m, stub);
      assert.ok(!r.ok && r.failure.kind === kind, JSON.stringify(r));
    });
  }
});
