// Code shown in the article "react-native-force-update-fail-open".

// snippet:start types
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
// snippet:end types

// snippet:start load-policy
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
// snippet:end load-policy

// snippet:start decide-gate
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
// snippet:end decide-gate

// snippet:start validation
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
// snippet:end validation

export type { GateState, PolicyResult, VersionPolicy };
export { decideGate, isAllowedStoreURL, loadPolicy };
