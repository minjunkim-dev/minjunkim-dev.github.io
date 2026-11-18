// Runs `npm audit` and fails on any moderate-or-higher advisory, except the
// advisories listed in ALLOW until their expiry date. An expired entry fails CI.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// advisory URL -> last day (UTC) it is allowed, and why. Only an exact URL match is allowed.
const ALLOW = new Map([
  ["https://github.com/advisories/GHSA-fc5q-39xc-vjpf", {
    until: "2026-12-18",
    why: "picomatch ReDoS. Every published version is affected and no fix exists. picomatch runs only at build time, with globs from this repository.",
  }],
]);
const LEVELS = new Set(["moderate", "high", "critical"]);

export function check(report, today) {
  if (report.error) return { failed: [`npm audit error: ${JSON.stringify(report.error)}`], allowed: [] };
  const vulns = report.vulnerabilities;
  // An unknown report shape must fail, not pass with zero findings.
  if (!vulns || typeof vulns !== "object" || Array.isArray(vulns)) {
    return { failed: ["npm audit output has no vulnerabilities object"], allowed: [] };
  }
  const seen = new Map();
  const failed = [];
  for (const [name, vuln] of Object.entries(vulns)) {
    if (!Array.isArray(vuln?.via)) {
      failed.push(`npm audit output: ${name} has no via list`);
      continue;
    }
    for (const via of vuln.via) {
      if (typeof via !== "object" || !LEVELS.has(via.severity)) continue;
      const key = String(via.url ?? via.source);
      seen.set(key, `${key} ${via.severity} ${via.name}: ${via.title}`);
    }
  }
  const allowed = [];
  for (const [key, line] of seen) {
    const entry = ALLOW.get(key);
    if (!entry) failed.push(line);
    else if (today <= entry.until) allowed.push(`${line} (allowed until ${entry.until})`);
  }
  // An expired entry fails even when npm no longer reports it, so it gets removed.
  for (const [key, entry] of ALLOW) if (today > entry.until) failed.push(`${key} allowance expired ${entry.until}`);
  return { failed, allowed };
}

// Compare real paths: a URL-encoded or symlinked path must not skip the audit.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  let out;
  try {
    out = execFileSync("npm", ["audit", "--include=dev", "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch (e) {
    out = e.stdout; // npm audit exits 1 when it finds anything
  }
  const { failed, allowed } = check(JSON.parse(out), new Date().toISOString().slice(0, 10));
  for (const line of allowed) console.log(`::warning::${line}`);
  for (const line of failed) console.log(`::error::${line}`);
  if (failed.length) process.exit(1);
  console.log(`npm audit: no moderate or higher advisories outside the allowlist (${allowed.length} allowed).`);
}
