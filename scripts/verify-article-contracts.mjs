import { readFile } from 'node:fs/promises';
import process from 'node:process';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const [forceUpdate, downsampling, readme] = await Promise.all([
  readFile(new URL('src/content/writing/react-native-force-update-fail-open.md', root), 'utf8'),
  readFile(new URL('src/content/writing/imageio-downsampling-memory-stability.md', root), 'utf8'),
  readFile(new URL('README.md', root), 'utf8'),
]);

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

const checks = [
  {
    name: 'store URL validation must parse the URL instead of trusting an HTTPS prefix',
    pass:
      !forceUpdate.includes("value.startsWith('https://')") &&
      /new URL\(value\)/.test(forceUpdate) &&
      /url\.protocol\s*(?:===|!==)\s*['"]https:['"]/.test(forceUpdate),
  },
  {
    name: 'store URL validation must reject credentials',
    pass:
      /url\.username\s*(?:===|!==)\s*['"]{2}/.test(forceUpdate) &&
      /url\.password\s*(?:===|!==)\s*['"]{2}/.test(forceUpdate),
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
