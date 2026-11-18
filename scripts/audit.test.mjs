import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "./audit.mjs";

const adv = (id, severity = "high") => ({
  source: 1, name: "pkg", title: "t", severity, url: `https://github.com/advisories/${id}`,
});
const report = (...via) => ({ vulnerabilities: { pkg: { via: [...via, "other-pkg"] } } });

test("allowed advisory passes before expiry", () => {
  const r = check(report(adv("GHSA-fc5q-39xc-vjpf")), "2026-12-18");
  assert.deepEqual([r.failed.length, r.allowed.length], [0, 1]);
});

test("allowed advisory fails after expiry", () => {
  assert.equal(check(report(adv("GHSA-fc5q-39xc-vjpf")), "2026-12-19").failed.length, 1);
});

test("any other moderate advisory fails", () => {
  assert.equal(check(report(adv("GHSA-aaaa-bbbb-cccc", "moderate")), "2026-11-18").failed.length, 1);
});

test("low advisories are ignored", () => {
  assert.equal(check(report(adv("GHSA-aaaa-bbbb-cccc", "low")), "2026-11-18").failed.length, 0);
});

test("npm audit error fails", () => {
  assert.equal(check({ error: { code: "ENOTFOUND" } }, "2026-11-18").failed.length, 1);
});

test("output without a vulnerabilities object fails", () => {
  for (const r of [{}, { auditReportVersion: 2 }, { vulnerabilities: [] }, { vulnerabilities: null }]) {
    assert.equal(check(r, "2026-11-18").failed.length, 1);
  }
});

test("a record without a via list fails", () => {
  assert.equal(check({ vulnerabilities: { pkg: { severity: "high" } } }, "2026-11-18").failed.length, 1);
  assert.equal(check({ vulnerabilities: { pkg: { severity: "high", via: [] } } }, "2026-11-18").failed.length, 1);
});

test("only the exact advisory URL is allowed", () => {
  const other = { ...adv("GHSA-fc5q-39xc-vjpf"), url: "https://example.com/GHSA-fc5q-39xc-vjpf" };
  const proto = { ...adv("x"), url: "toString" };
  assert.equal(check(report(other, proto), "2026-11-18").failed.length, 2);
});

test("an expired entry fails even when npm no longer reports it", () => {
  assert.equal(check({ vulnerabilities: {} }, "2026-12-19").failed.length, 1);
  assert.equal(check({ vulnerabilities: {} }, "2026-12-18").failed.length, 0);
});
