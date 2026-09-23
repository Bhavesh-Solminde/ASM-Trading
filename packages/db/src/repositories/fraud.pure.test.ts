import { describe, expect, it } from "vitest";
import { detectLinkage, type UserFacts } from "./fraud";

/**
 * Pure-function tests for the linked-accounts detector. No DB — every input
 * is a plain UserFacts record, so this suite runs the moment the file is
 * saved, catches regressions instantly, and pins the scoring semantics as an
 * executable contract.
 *
 * The `flag*` DB-integration tests live in a separate file that needs a
 * Postgres to talk to; the scoring logic itself lives here.
 */

const NOW_SEC = 1_700_000_000;

function facts(overrides: Partial<UserFacts>): UserFacts {
  return {
    userId: overrides.userId ?? "u-primary",
    signupIp: null,
    lastIp: null,
    signupUserAgent: null,
    lastUserAgent: null,
    signupDeviceFp: null,
    depositMethods: [],
    createdAtSec: NOW_SEC,
    ...overrides,
  };
}

describe("detectLinkage — clean cases", () => {
  it("returns CLEAN when there are no candidates", () => {
    const result = detectLinkage(facts({ signupIp: "203.0.113.4" }), []);
    expect(result.verdict).toBe("CLEAN");
    expect(result.userIds).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("returns CLEAN when nothing overlaps", () => {
    const primary = facts({
      signupIp: "203.0.113.4",
      signupUserAgent: "Mozilla A",
      depositMethods: ["upi"],
    });
    const candidate = facts({
      userId: "u-other",
      signupIp: "198.51.100.7",
      signupUserAgent: "Mozilla B",
      depositMethods: ["bank"],
    });
    expect(detectLinkage(primary, [candidate]).verdict).toBe("CLEAN");
  });

  it("does NOT link two pre-migration users whose fields are both null", () => {
    // Both users have null IP/UA/fp/methods. Empty-set intersections must
    // never match — otherwise every legacy user would link to every other.
    const a = facts({ userId: "a" });
    const b = facts({ userId: "b" });
    expect(detectLinkage(a, [b]).verdict).toBe("CLEAN");
  });

  it("ignores the primary if it appears in the candidate list", () => {
    const p = facts({ userId: "u-1", signupIp: "203.0.113.4" });
    const dupe = facts({ userId: "u-1", signupIp: "203.0.113.4" });
    expect(detectLinkage(p, [dupe]).verdict).toBe("CLEAN");
  });
});

describe("detectLinkage — weak links", () => {
  it("shared IP alone is WEAKLY_LINKED, not LINKED", () => {
    const primary = facts({ userId: "a", signupIp: "203.0.113.4" });
    const candidate = facts({
      userId: "b",
      signupIp: "203.0.113.4",
      createdAtSec: NOW_SEC + 30 * 24 * 3600, // signed up 30 days later
    });
    const result = detectLinkage(primary, [candidate]);
    // shared IP = 3, no signup proximity, no UA match => score 3
    expect(result.verdict).toBe("WEAKLY_LINKED");
    expect(result.score).toBe(3);
    expect(result.evidence.sharedIps).toEqual(["203.0.113.4"]);
  });
});

describe("detectLinkage — hard links", () => {
  it("same IP + same UA + signed up within 24h is LINKED", () => {
    const primary = facts({
      userId: "a",
      signupIp: "203.0.113.4",
      signupUserAgent: "Mozilla-attack",
    });
    const candidate = facts({
      userId: "b",
      signupIp: "203.0.113.4",
      signupUserAgent: "Mozilla-attack",
      createdAtSec: NOW_SEC + 60, // one minute later
    });
    const result = detectLinkage(primary, [candidate]);
    // IP(3) + UA-on-top-of-IP(2) + within-24h(3) = 8
    expect(result.verdict).toBe("LINKED");
    expect(result.score).toBeGreaterThanOrEqual(5);
    expect(result.evidence.sharedIps).toEqual(["203.0.113.4"]);
    expect(result.evidence.sharedUserAgents).toEqual(["Mozilla-attack"]);
    expect(result.evidence.minSignupGapSec).toBe(60);
  });

  it("same device fingerprint LINKS even without IP overlap", () => {
    const primary = facts({
      userId: "a",
      signupIp: "203.0.113.4",
      signupDeviceFp: "fp-abcdef",
    });
    const candidate = facts({
      userId: "b",
      signupIp: "10.0.0.1", // different network
      signupDeviceFp: "fp-abcdef",
    });
    const result = detectLinkage(primary, [candidate]);
    // deviceFp(5) = 5
    expect(result.verdict).toBe("LINKED");
    expect(result.evidence.sharedDeviceFps).toEqual(["fp-abcdef"]);
  });

  it("same deposit method across users LINKS", () => {
    const primary = facts({
      userId: "a",
      signupIp: "203.0.113.4",
      depositMethods: ["upi:attacker@bank"],
    });
    const candidate = facts({
      userId: "b",
      signupIp: "198.51.100.9",
      depositMethods: ["upi:attacker@bank"],
    });
    const result = detectLinkage(primary, [candidate]);
    // method(5) = 5
    expect(result.verdict).toBe("LINKED");
    expect(result.evidence.sharedMethods).toEqual(["upi:attacker@bank"]);
  });

  it("groups the primary and all matched candidates in one linkage", () => {
    const primary = facts({ userId: "primary", signupIp: "203.0.113.4" });
    const b = facts({
      userId: "b",
      signupIp: "203.0.113.4",
      signupUserAgent: "Mozilla",
      createdAtSec: NOW_SEC + 10,
    });
    const c = facts({
      userId: "c",
      signupIp: "203.0.113.4",
      signupUserAgent: "Mozilla",
      createdAtSec: NOW_SEC + 100,
    });
    const unrelated = facts({ userId: "d", signupIp: "10.0.0.5" });
    const result = detectLinkage(primary, [b, c, unrelated]);
    expect(result.verdict).toBe("LINKED");
    expect(result.userIds).toEqual(expect.arrayContaining(["primary", "b", "c"]));
    expect(result.userIds).not.toContain("d");
  });
});

describe("detectLinkage — the classic hazzing (multi-account bonus abuse)", () => {
  it("flags 3 accounts signed up from the same IP within minutes", () => {
    // Attacker registers three accounts back-to-back to farm 3× the deposit
    // bonus, then plans opposite trades to try to convert some into real
    // balance. Same IP, same UA — the detector must flag this before the
    // bonus grant becomes useful money.
    const t = 1_700_000_000;
    const a = facts({ userId: "acct-a", signupIp: "1.2.3.4", signupUserAgent: "Chrome-1", createdAtSec: t });
    const b = facts({ userId: "acct-b", signupIp: "1.2.3.4", signupUserAgent: "Chrome-1", createdAtSec: t + 120 });
    const c = facts({ userId: "acct-c", signupIp: "1.2.3.4", signupUserAgent: "Chrome-1", createdAtSec: t + 240 });
    for (const primary of [a, b, c]) {
      const others = [a, b, c].filter((f) => f.userId !== primary.userId);
      const result = detectLinkage(primary, others);
      expect(result.verdict).toBe("LINKED");
      // Every account should see the other two as linked.
      expect(result.userIds.length).toBe(3);
    }
  });

  it("does NOT flag two accounts signed up months apart from the same public IP", () => {
    // Common false positive: shared workplace or ISP-pool IP. Without any
    // second signal (device fp, deposit method, or signup proximity), we
    // stop at WEAKLY_LINKED — not LINKED — so the admin isn't drowned in
    // false positives from shared NATs.
    const a = facts({ userId: "a", signupIp: "203.0.113.4", createdAtSec: NOW_SEC });
    const b = facts({
      userId: "b",
      signupIp: "203.0.113.4",
      createdAtSec: NOW_SEC + 90 * 24 * 3600, // 90 days later
    });
    const result = detectLinkage(a, [b]);
    expect(result.verdict).toBe("WEAKLY_LINKED");
  });

  it("catches an attacker on a fresh VPN when they reuse the same UPI address", () => {
    // The attacker rotates IPs (VPN) and UAs (private windows) but has to
    // deposit real money, and their bank UPI ID is the same across all
    // accounts. This is the "hardest to hide" signal — hence its high score.
    const a = facts({ userId: "a", signupIp: "45.66.77.88", depositMethods: ["upi:attacker@icici"] });
    const b = facts({ userId: "b", signupIp: "34.55.66.77", depositMethods: ["upi:attacker@icici"] });
    expect(detectLinkage(a, [b]).verdict).toBe("LINKED");
  });
});
