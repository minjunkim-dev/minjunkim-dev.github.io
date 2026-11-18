// Runs `npm audit` and fails on any moderate-or-higher advisory, except the
// advisories listed in ALLOW until their expiry date. An expired entry fails CI.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// advisory id -> last day (UTC) it is allowed, and why.
const ALLOW = {
  "GHSA-fc5q-39xc-vjpf": {
    until: "2026-12-18",
    why: "picomatch ReDoS. Every published version is affected and no fix exists. picomatch runs only at build time, with globs from this repository.",
  },
};
const LEVELS = new Set(["moderate", "high", "critical"]);

export function check(report, today) {
  if (report.error) return { failed: [`npm audit error: ${JSON.stringify(report.error)}`], allowed: [] };
  const vulns = report.vulnerabilities;
  // An unknown report shape must fail, not pass with zero findings.
  if (!vulns || typeof vulns !== "object" || Array.isArray(vulns)) {
    return { failed: ["npm audit output has no vulnerabilities object"], allowed: [] };
  }
  const seen = new Map();
  for (const vuln of Object.values(vulns)) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || !LEVELS.has(via.severity)) continue;
      const id = String(via.url ?? "").split("/").pop() || String(via.source);
      seen.set(id, `${id} ${via.severity} ${via.name}: ${via.title}`);
    }
  }
  const failed = [];
  const allowed = [];
  for (const [id, line] of seen) {
    const entry = ALLOW[id];
    if (!entry) failed.push(line);
    else if (today > entry.until) failed.push(`${line} (allowance expired ${entry.until})`);
    else allowed.push(`${line} (allowed until ${entry.until})`);
  }
  return { failed, allowed };
}

// Compare real paths: a URL-encoded or symlinked path must not skip the audit.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
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
