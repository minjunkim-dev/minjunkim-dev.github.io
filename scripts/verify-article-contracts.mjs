import { readFile } from 'node:fs/promises';
import process from 'node:process';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const [forceUpdate, downsampling, deployVerify, readme] = await Promise.all([
  readFile(new URL('src/content/writing/react-native-force-update-fail-open.md', root), 'utf8'),
  readFile(new URL('src/content/writing/imageio-downsampling-memory-stability.md', root), 'utf8'),
  readFile(new URL('src/content/writing/web-deploy-verify-public-sha256.md', root), 'utf8'),
  readFile(new URL('README.md', root), 'utf8'),
]);

const { readdir } = await import('node:fs/promises');
const articleDir = new URL('src/content/writing/', root);
const articles = await Promise.all(
  (await readdir(articleDir))
    .filter((name) => name.endsWith('.md'))
    .map(async (name) => {
      const text = await readFile(new URL(name, articleDir), 'utf8');
      return { name, body: text.slice(text.indexOf('---', 3) + 3) };
    }),
);

const typeScriptBlocks = [
  ...forceUpdate.matchAll(/```typescript\n([\s\S]*?)```/g),
].map((match) => match[1]);
const typeDefinitions = typeScriptBlocks.find((block) =>
  block.includes('type Platform'),
);
const storeURLGuard = typeScriptBlocks.find((block) =>
  block.includes('function isAllowedStoreURL'),
);

let storeURLBehaviorPass = false;
let storeURLBehaviorError = '';
if (typeDefinitions && storeURLGuard) {
  const runtimeCases = `
const cases: Array<[unknown, Platform, boolean]> = [
  ['https://apps.apple.com/kr/app/example/id1234567890', 'ios', true],
  ['https://play.google.com/store/apps/details?id=com.example.app', 'android', true],
  ['https://', 'ios', false],
  ['https://[bad', 'ios', false],
  ['https://user:secret@apps.apple.com/app/id1234567890', 'ios', false],
  ['https://apps.apple.com.evil.example/app/id1234567890', 'ios', false],
  ['https://apps.apple.com/kr/app/example/id1234567890', 'android', false],
  ['https://apps.apple.com:8443/app/id1234567890', 'ios', false],
  ['https://play.google.com/store/apps/details?hl=ko', 'android', false],
  // Garbage must return false, not throw (React Native's URL getters throw).
  [42, 'ios', false],
  ['https://apps.apple.com/%E0%A4%A/id1', 'android', false],
  ['\u0000https://apps.apple.com/app/id1234567890', 'ios', false],
];
for (const [value, platform, expected] of cases) {
  if (isAllowedStoreURL(value, platform) !== expected) {
    throw new Error(String(value));
  }
}
`;
  const transpiled = ts.transpileModule(
    `${typeDefinitions}\n${storeURLGuard}\n${runtimeCases}`,
    {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        strict: true,
      },
      reportDiagnostics: true,
    },
  );

  if (transpiled.diagnostics?.length) {
    storeURLBehaviorError = transpiled.diagnostics
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
      .join('\n');
  } else {
    try {
      Function(transpiled.outputText)();
      storeURLBehaviorPass = true;
    } catch (error) {
      storeURLBehaviorError =
        error instanceof Error ? error.message : String(error);
    }
  }
}

// Execute the article's loader with real Response JSON parsing and a local fetch stub.
const loader = typeScriptBlocks.find((block) => block.includes('async function loadPolicy'));
const loaderJS = ts.transpileModule(`${typeDefinitions}\n${storeURLGuard}\n${loader}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const policy = {
  minimumVersion: { ios: '2.0.0', android: '2.0.0' },
  storeURL: {
    ios: 'https://apps.apple.com/app/id1234567890',
    android: 'https://play.google.com/store/apps/details?id=com.example.app',
  },
};
const loaderCases = [
  [async () => new Response('{broken'), 'invalid-payload'],
  [async () => new Response('{}'), 'invalid-payload'],
  [async () => new Response('', { status: 503 }), 'http'],
  [async () => { throw new TypeError('offline'); }, 'network'],
  [async () => { throw new DOMException('cancelled', 'AbortError'); }, 'timeout'],
  [async () => new Response(JSON.stringify(policy)), undefined],
];
for (const [fetchStub, expected] of loaderCases) {
  const run = Function('fetch', `${loaderJS}\nreturn loadPolicy('https://example.invalid/policy', 1000);`);
  const result = await run(fetchStub);
  if (result.reason !== expected || result.ok !== (expected === undefined)) {
    throw new Error(`Policy loader: expected ${expected ?? 'success'}, got ${JSON.stringify(result)}`);
  }
}
console.log(`Policy loader runtime checks passed (${loaderCases.length} cases).`);

// Execute the article's gate decision: only a confirmed policy with an older version may block.
const decider = typeScriptBlocks.find((block) => block.includes('function decideGate'));
const deciderJS = ts.transpileModule(`${typeDefinitions}\n${storeURLGuard}\n${decider}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const decide = Function(`${deciderJS}\nreturn decideGate;`)();
const gateCases = [
  ['2.0.0', { ok: true, policy }, { kind: 'open', mode: 'normal' }],
  ['2.0.1', { ok: true, policy }, { kind: 'open', mode: 'normal' }],
  ['1.9.9', { ok: true, policy }, { kind: 'blocked', minimumVersion: '2.0.0', storeURL: policy.storeURL.ios }],
  ['1.9.9', { ok: false, reason: 'timeout' }, { kind: 'open', mode: 'fail-open', reason: 'timeout' }],
  ['1.9.9', { ok: false, reason: 'network' }, { kind: 'open', mode: 'fail-open', reason: 'network' }],
  ['bad', { ok: true, policy }, { kind: 'open', mode: 'fail-open', reason: 'invalid-app-version' }],
  ['1.9.9', { ok: true, policy: { ...policy, minimumVersion: { ios: '99999999999999999.0.0', android: '2.0.0' } } }, { kind: 'open', mode: 'fail-open', reason: 'invalid-payload' }],
];
for (const [version, result, expected] of gateCases) {
  const actual = decide(version, 'ios', result);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`decideGate(${version}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
console.log(`Gate decision runtime checks passed (${gateCases.length} cases).`);

// Execute the deploy-verification article: manifest, upload order, and public-response hash checks.
const deployBlocks = [...deployVerify.matchAll(/```typescript\n([\s\S]*?)```/g)].map((match) => match[1]);
const deployJS = ts.transpileModule(deployBlocks.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const AsyncFunction = (async () => {}).constructor;
const { createManifest, uploadOrder, verifyRelease, MARKER, IMMUTABLE, NO_CACHE } = await new AsyncFunction(
  `${deployJS}\nreturn { createManifest, uploadOrder, verifyRelease, MARKER, IMMUTABLE, NO_CACHE };`,
)();
{
const enc = (s) => new TextEncoder().encode(s);
const commit = 'a'.repeat(40);
const html = '<!doctype html><link rel="stylesheet" href="/assets/index-AbCd1234.css"><script type="module" src="/assets/index-Ef56Gh78.js"></script><a href="https://cdn.example.org/x.js">x</a>';
const build = new Map([
  ['index.html', enc(html)],
  ['assets/index-AbCd1234.css', enc('body{}')],
  ['assets/index-Ef56Gh78.js', enc('console.log(1)')],
  ['favicon.ico', enc('ico')],
]);

let threw = false;
try { await createManifest('r1', 'abc', build); } catch { threw = true; }
if (!threw) throw new Error('short commit must be rejected');
threw = false;
try { await createManifest('r1', commit, new Map([['../x', enc('x')], ['index.html', enc('h')]])); } catch { threw = true; }
if (!threw) throw new Error('path traversal must be rejected');

const manifest = await createManifest('r1', commit, build);
const byPath = Object.fromEntries(manifest.files.map((f) => [f.path, f]));
if (!byPath[MARKER]) throw new Error('marker must be added');
if (byPath['assets/index-Ef56Gh78.js'].cacheControl !== IMMUTABLE) throw new Error('hashed js must be immutable');
if (byPath['index.html'].cacheControl !== NO_CACHE) throw new Error('html must be no-cache');
if (byPath['favicon.ico'].cacheControl !== NO_CACHE) throw new Error('unhashed file must be no-cache');

const order = uploadOrder(manifest);
if (order.slice(-2).join() !== ['index.html', MARKER].join()) throw new Error('html and marker go last');
if (order.length !== manifest.files.length) throw new Error('every file is uploaded once');

const served = new Map([...build, [MARKER, enc(JSON.stringify({ releaseId: 'r1', sourceCommit: commit }) + '\n')]]);
const site = (overrides = {}) => async (input) => {
  const url = new URL(input);
  const path = url.pathname.replace(/^\//, '');
  const o = overrides[path];
  if (o === 'throw') throw new TypeError('offline');
  if (o && o.redirect) return Object.defineProperty(new Response('x'), 'url', { value: o.redirect });
  if (o && o.status) return new Response('', { status: o.status });
  if (o && o.body !== undefined) return new Response(o.body);
  if (!served.has(path)) return new Response(served.get('index.html')); // SPA fallback: 200 + index.html
  return new Response(served.get(path));
};

const origin = 'https://web.example.com/';
const cases = [
  ['all good', site(), (r) => r.ok && r.checked.length === 4],
  ['stale html from cache', site({ 'index.html': { body: '<!doctype html><script src="/assets/old-11111111.js"></script>' } }), (r) => r.failure?.kind === 'mismatch' && r.failure.path === 'index.html'],
  ['spa fallback for asset', site({ 'assets/index-Ef56Gh78.js': { body: html } }), (r) => r.failure?.kind === 'mismatch' && r.failure.path === 'assets/index-Ef56Gh78.js'],
  ['asset 404', site({ 'assets/index-AbCd1234.css': { status: 404 } }), (r) => r.failure?.kind === 'http' && r.failure.status === 404],
  ['network error', site({ [MARKER]: 'throw' }), (r) => r.failure?.kind === 'network'],
  ['redirect to another host', site({ [MARKER]: { redirect: 'https://login.example.net/' } }), (r) => r.failure?.kind === 'redirect'],
  ['old marker', site({ [MARKER]: { body: '{"releaseId":"r0"}\n' } }), (r) => r.failure?.kind === 'mismatch' && r.failure.path === MARKER],
];
for (const [name, fetchStub, expect] of cases) {
  const result = await verifyRelease(origin, manifest, fetchStub);
  if (!expect(result)) throw new Error(`verifyRelease ${name}: ${JSON.stringify(result)}`);
}

// HTML that references a file not in the release, malformed escapes, or no JS.
for (const [name, page, kind] of [
  ['unknown asset', '<script src="/assets/missing-99999999.js"></script>', 'unknown-asset'],
  ['malformed escape', '<script src="/assets/%E0%A4%A.js"></script>', 'unknown-asset'],
  ['no js entrypoint', '<link rel="stylesheet" href="/assets/index-AbCd1234.css">', 'no-entrypoint'],
]) {
  const b = new Map(build).set('index.html', enc(page));
  const m = await createManifest('r2', commit, b);
  const s = new Map([...b, [MARKER, enc(JSON.stringify({ releaseId: 'r2', sourceCommit: commit }) + '\n')]]);
  const stub = async (input) => {
    const p = new URL(input).pathname.replace(/^\//, '');
    return new Response(s.get(p) ?? s.get('index.html'));
  };
  const r = await verifyRelease(origin, m, stub);
  if (r.ok || r.failure.kind !== kind) throw new Error(`verifyRelease ${name}: ${JSON.stringify(r)}`);
}
const deployCaseCount = cases.length + 3;
console.log(`Deploy verification runtime checks passed (${deployCaseCount} cases).`);
}

const checks = [
  {
    // React Native 0.79's built-in URL getters throw, so the guard must not depend on URL.
    name: 'store URL validation must parse with an anchored HTTPS pattern, not URL or a prefix check',
    pass:
      Boolean(storeURLGuard) &&
      !storeURLGuard.includes("value.startsWith('https://')") &&
      !/new URL\(/.test(storeURLGuard) &&
      storeURLGuard.includes('/^https:\\/\\/('),
  },
  {
    name: 'store URL validation must explain why it avoids URL in React Native',
    pass: forceUpdate.includes('React Native 0.79의 내장 `URL`'),
  },
  {
    name: 'store URL validation must allowlist the official platform hosts',
    pass: forceUpdate.includes('apps.apple.com') && forceUpdate.includes('play.google.com'),
  },
  {
    name: 'URL tests must cover malformed and credential-bearing values',
    pass:
      forceUpdate.includes('https://[bad') &&
      forceUpdate.includes('https://user:secret@apps.apple.com'),
  },
  {
    name: 'the article store URL guard must pass all runtime cases',
    pass: storeURLBehaviorPass,
  },
  {
    name: 'force-update article must compare fail-open with fail-closed before the code',
    pass:
      forceUpdate.includes('## 결정') &&
      forceUpdate.indexOf('fail-closed') > -1 &&
      forceUpdate.indexOf('fail-closed') < forceUpdate.indexOf('## 구현 1'),
  },
  {
    name: 'force-update article must include an accessible state diagram',
    pass: /<svg[^>]*role="img"[^>]*aria-label="[^"]+"/.test(forceUpdate),
  },
  {
    name: 'force-update article must state results with their measurement source',
    pass: forceUpdate.includes('## 결과') && forceUpdate.includes('콘솔 조회값'),
  },
  {
    name: 'ImageIO decoding must expose explicit aspect-fit and aspect-fill policies',
    pass:
      /enum ContentMode/.test(downsampling) &&
      downsampling.includes('case aspectFit') &&
      downsampling.includes('case aspectFill'),
  },
  {
    name: 'ImageIO decoding must inspect source pixel dimensions',
    pass:
      downsampling.includes('CGImageSourceCopyPropertiesAtIndex') &&
      downsampling.includes('sourcePixelSize') &&
      downsampling.includes('targetPixelSize'),
  },
  {
    name: 'ImageIO pixel budget must use fit/fill-specific scale ratios',
    pass:
      /case \.aspectFit:[\s\S]*?min\(/.test(downsampling) &&
      /case \.aspectFill:[\s\S]*?max\(/.test(downsampling),
  },
  {
    name: 'aspect-fill regression example must preserve the crop pixel budget',
    pass:
      downsampling.includes('testAspectFillPreservesCropPixelBudget') &&
      downsampling.includes('XCTAssertEqual(maxPixelSize, 800)'),
  },
  {
    name: 'cache key and decoder must share one content-mode type',
    pass: downsampling.includes('let contentMode: ThumbnailDecoder.ContentMode'),
  },
  {
    name: 'deploy-verification article must define success before the code and compare signals',
    pass:
      deployVerify.includes('## 결정') &&
      deployVerify.indexOf('## 결정') < deployVerify.indexOf('## 구현 1') &&
      deployVerify.includes('| HTTP 200 |'),
  },
  {
    name: 'deploy-verification article must include an accessible flow diagram',
    pass: /<svg[^>]*role="img"[^>]*aria-label="[^"]+"/.test(deployVerify),
  },
  {
    name: 'deploy-verification article must state results with measurement conditions and limits',
    pass: deployVerify.includes('## 결과') && deployVerify.includes('측정 조건') && deployVerify.includes('## 의견'),
  },
  {
    name: 'deploy-verification article must not expose account IDs or CDN distribution IDs',
    pass: !/\b\d{12}\b/.test(deployVerify) && !/\bE[0-9A-Z]{12,13}\b/.test(deployVerify),
  },
  {
    name: 'every article must open with a three-line summary before its first section',
    pass: articles.every(({ body }) => {
      const summary = body.indexOf('**요약**');
      const firstSection = body.indexOf('\n## ');
      const bullets = body.slice(summary, firstSection).split('\n').filter((line) => line.startsWith('- '));
      return summary > -1 && summary < firstSection && bullets.length === 3;
    }),
  },
  {
    name: 'README must match the Node version used by the deployment workflow',
    pass: /Node\.js 24/.test(readme),
  },
];

const failures = checks.filter(({ pass }) => !pass).map(({ name }) => name);

if (failures.length > 0) {
  console.error('Article contract verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  if (storeURLBehaviorError) {
    console.error(`Store URL runtime error: ${storeURLBehaviorError}`);
  }
  process.exit(1);
}

console.log(`Article contract verification passed (${checks.length} checks).`);
