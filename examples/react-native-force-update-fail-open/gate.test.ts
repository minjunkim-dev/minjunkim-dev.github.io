import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideGate, isAllowedStoreURL, loadPolicy } from './gate.ts';
import type { VersionPolicy } from './gate.ts';

// snippet:start decide-gate-tests
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
    assert.deepEqual(decideGate('2.4.0', 'ios', { ok: true, policy }), {
      kind: 'open',
      mode: 'normal',
    });
  });

  it('blocks only an older version with a confirmed policy', () => {
    assert.deepEqual(decideGate('2.3.9', 'ios', { ok: true, policy }), {
      kind: 'blocked',
      minimumVersion: '2.4.0',
      storeURL: 'https://apps.apple.com/app/id1234567890',
    });
  });

  for (const reason of ['timeout', 'network', 'http', 'invalid-payload'] as const) {
    it(`fails open on ${reason}`, () => {
      assert.deepEqual(decideGate('2.3.9', 'ios', { ok: false, reason }), {
        kind: 'open',
        mode: 'fail-open',
        reason,
      });
    });
  }

  it('fails open on an invalid app version', () => {
    assert.deepEqual(decideGate('2.4', 'ios', { ok: true, policy }), {
      kind: 'open',
      mode: 'fail-open',
      reason: 'invalid-app-version',
    });
  });
});
// snippet:end decide-gate-tests

describe('decideGate edge cases', () => {
  it('fails open when the policy version is not a safe integer', () => {
    const huge = { ...policy, minimumVersion: { ios: '99999999999999999.0.0', android: '3.1.0' } };
    assert.deepEqual(decideGate('1.9.9', 'ios', { ok: true, policy: huge }), {
      kind: 'open',
      mode: 'fail-open',
      reason: 'invalid-payload',
    });
  });
});

// snippet:start store-url-tests
describe('isAllowedStoreURL', () => {
  it('accepts only the platform store destination shape', () => {
    assert.equal(
      isAllowedStoreURL('https://apps.apple.com/kr/app/example/id1234567890', 'ios'),
      true,
    );
    assert.equal(
      isAllowedStoreURL(
        'https://play.google.com/store/apps/details?id=com.example.app',
        'android',
      ),
      true,
    );
  });

  for (const value of [
    'https://',
    'https://[bad',
    'https://user:secret@apps.apple.com/app/id1234567890',
    'https://apps.apple.com.evil.example/app/id1234567890',
    'https://apps.apple.com:8443/app/id1234567890',
  ]) {
    it(`rejects an unsafe iOS store URL: ${value}`, () => {
      assert.equal(isAllowedStoreURL(value, 'ios'), false);
    });
  }
});
// snippet:end store-url-tests

describe('isAllowedStoreURL outside the article table', () => {
  it('rejects other shapes and garbage without throwing', () => {
    assert.equal(isAllowedStoreURL('https://apps.apple.com/kr/app/example/id1234567890', 'android'), false);
    assert.equal(isAllowedStoreURL('https://play.google.com/store/apps/details?hl=ko', 'android'), false);
    assert.equal(isAllowedStoreURL(42, 'ios'), false);
    assert.equal(isAllowedStoreURL('https://apps.apple.com/%E0%A4%A/id1', 'android'), false);
    assert.equal(isAllowedStoreURL('\u0000https://apps.apple.com/app/id1234567890', 'ios'), false);
  });

  it('works when URL getters throw, as in React Native 0.79', () => {
    const original = globalThis.URL;
    globalThis.URL = class {
      get hostname(): string { throw new Error('not implemented'); }
      get protocol(): string { throw new Error('not implemented'); }
    } as unknown as typeof URL;
    try {
      assert.equal(isAllowedStoreURL('https://apps.apple.com/app/id1234567890', 'ios'), true);
    } finally {
      globalThis.URL = original;
    }
  });
});

describe('loadPolicy', () => {
  const valid = {
    minimumVersion: { ios: '2.0.0', android: '2.0.0' },
    storeURL: policy.storeURL,
  };
  const cases: Array<[string, () => Promise<Response>, string | undefined]> = [
    ['broken JSON', async () => new Response('{broken'), 'invalid-payload'],
    ['wrong shape', async () => new Response('{}'), 'invalid-payload'],
    ['HTTP 503', async () => new Response('', { status: 503 }), 'http'],
    ['offline', async () => { throw new TypeError('offline'); }, 'network'],
    ['abort', async () => { throw new DOMException('cancelled', 'AbortError'); }, 'timeout'],
    ['valid policy', async () => new Response(JSON.stringify(valid)), undefined],
  ];

  for (const [name, fetchStub, expected] of cases) {
    it(`classifies ${name}`, async () => {
      const original = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const result = await loadPolicy('https://example.invalid/policy', 1000);
        assert.equal(result.ok, expected === undefined);
        if (!result.ok) assert.equal(result.reason, expected);
      } finally {
        globalThis.fetch = original;
      }
    });
  }

  it('times out a request that never answers', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    try {
      assert.deepEqual(await loadPolicy('https://example.invalid/policy', 10), { ok: false, reason: 'timeout' });
    } finally {
      globalThis.fetch = original;
    }
  });
});
