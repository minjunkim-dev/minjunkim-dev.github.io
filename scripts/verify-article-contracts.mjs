// Checks article structure and the shape of the code each article shows.
// The code itself runs as tests in examples/ (npm run test:examples, swift test, xcodebuild test).
import { readdir, readFile } from 'node:fs/promises';
import process from 'node:process';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [forceUpdate, downsampling, deployVerify, readme] = await Promise.all([
  read('src/content/writing/react-native-force-update-fail-open.mdx'),
  read('src/content/writing/imageio-downsampling-memory-stability.mdx'),
  read('src/content/writing/web-deploy-verify-public-sha256.mdx'),
  read('README.md'),
]);
const [gate, gateTests, decoder, decoderTests, cacheKey] = await Promise.all([
  read('examples/react-native-force-update-fail-open/gate.ts'),
  read('examples/react-native-force-update-fail-open/gate.test.ts'),
  read('examples/imageio-downsampling-memory-stability/Sources/Thumbnail/ThumbnailDecoder.swift'),
  read('examples/imageio-downsampling-memory-stability/Tests/ThumbnailTests/ArticleTests.swift'),
  read('examples/imageio-downsampling-memory-stability/Sources/Thumbnail/ThumbnailCacheKey.swift'),
]);

const articleDir = new URL('src/content/writing/', root);
const articles = await Promise.all(
  (await readdir(articleDir))
    .filter((name) => /\.mdx?$/.test(name))
    .map(async (name) => {
      const text = await readFile(new URL(name, articleDir), 'utf8');
      return { name, body: text.slice(text.indexOf('---', 3) + 3) };
    }),
);

const storeURLGuard = gate.slice(gate.indexOf('function isAllowedStoreURL'), gate.indexOf('function isVersionPolicy'));

const checks = [
  {
    // React Native 0.79's built-in URL getters throw, so the guard must not depend on URL.
    name: 'store URL validation must parse with an anchored HTTPS pattern, not URL or a prefix check',
    pass:
      storeURLGuard.length > 0 &&
      !storeURLGuard.includes("value.startsWith('https://')") &&
      !/new URL\(/.test(storeURLGuard) &&
      gate.includes('/^https:\\/\\/('),
  },
  {
    name: 'store URL validation must explain why it avoids URL in React Native',
    pass: forceUpdate.includes('React Native 0.79의 내장 `URL`'),
  },
  {
    name: 'store URL validation must allowlist the official platform hosts',
    pass: gate.includes("'apps.apple.com'") && gate.includes("'play.google.com'"),
  },
  {
    name: 'URL tests must cover malformed and credential-bearing values',
    pass: gateTests.includes('https://[bad') && gateTests.includes('https://user:secret@apps.apple.com'),
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
    // A result either names its measurement source or says why it is omitted.
    pass: forceUpdate.includes('## 결과') && (forceUpdate.includes('콘솔 조회값') || forceUpdate.includes('원본 자료가 없어')),
  },
  {
    name: 'ImageIO decoding must expose explicit aspect-fit and aspect-fill policies',
    pass: /enum ContentMode/.test(decoder) && decoder.includes('case aspectFit') && decoder.includes('case aspectFill'),
  },
  {
    name: 'ImageIO decoding must inspect source pixel dimensions',
    pass:
      decoder.includes('CGImageSourceCopyPropertiesAtIndex') &&
      decoder.includes('sourcePixelSize') &&
      decoder.includes('targetPixelSize'),
  },
  {
    name: 'ImageIO pixel budget must use fit/fill-specific scale ratios',
    pass: /case \.aspectFit:[\s\S]*?min\(/.test(decoder) && /case \.aspectFill:[\s\S]*?max\(/.test(decoder),
  },
  {
    name: 'aspect-fill regression example must preserve the crop pixel budget',
    pass:
      decoderTests.includes('testAspectFillPreservesCropPixelBudget') &&
      decoderTests.includes('XCTAssertEqual(maxPixelSize, 800)'),
  },
  {
    name: 'cache key and decoder must share one content-mode type',
    pass: cacheKey.includes('let contentMode: ThumbnailDecoder.ContentMode'),
  },
  {
    name: 'ImageIO article must show the tested decoder, not a copy',
    pass: downsampling.includes('<Snippet code={decoder}'),
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
  process.exit(1);
}

console.log(`Article contract verification passed (${checks.length} checks).`);
