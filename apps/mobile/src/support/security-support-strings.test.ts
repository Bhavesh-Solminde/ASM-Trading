import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAQ } from "@asm/contracts";
import { describe, expect, it } from "vitest";
import { lockValueKey } from "@/account/hub-model";
import en from "@/i18n/en.json";
import hi from "@/i18n/hi.json";
import { flattenKeys } from "@/i18n/keys";
import { biometricLabelKey } from "@/lock/biometric-label";
import { faqKeys, ticketProblems, ticketTag } from "./support-model";

const have = (locale: object) => new Set(flattenKeys(locale as Record<string, unknown>));

const root = join(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

const SCREENS = [
  "app/(tabs)/account/security.tsx",
  "app/(tabs)/account/security-pin.tsx",
  "app/(tabs)/account/support.tsx",
  "src/support/NewTicketSheet.tsx",
  "src/support/support-model.ts",
  "src/account/security-flow.ts",
];
const literal = SCREENS.flatMap((f) => [...read(f).matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)].map((m) => m[1] as string));
// Keys a model hands to a screen (`t(model.key)`), which no scan of the screen can see.
const modelKeys = [
  ...faqKeys(FAQ.length).flatMap((k) => [k.q, k.a]),
  ...(["OPEN", "ANSWERED", "CLOSED"] as const).map((s) => ticketTag(s).labelKey),
  ...Object.values(ticketProblems("", "")),
  "lock.mismatch",
  "support.whatsapp",
  "support.telegram",
  biometricLabelKey([]),
  biometricLabelKey([1]),
  ...[
    { enabled: true, method: "biometric" as const },
    { enabled: true, method: "pin" as const },
    { enabled: false, method: null },
  ].map(lockValueKey),
];

describe("Security and Support strings", () => {
  it("finds the keys it is meant to check", () => {
    expect(literal.length).toBeGreaterThan(25);
    expect(modelKeys.length).toBeGreaterThan(20);
  });

  for (const [name, locale] of [["English", en], ["Hindi", hi]] as const) {
    it(`every key the screens use exists in ${name}`, () => {
      const known = have(locale);
      // `lock.wrongPin` is plural: i18next resolves `_one` / `_other`.
      const missing = [...new Set([...modelKeys, ...literal])].filter((k) => !known.has(k) && !known.has(`${k}_other`));
      expect(missing).toEqual([]);
    });
  }

  it("the English FAQ is the contracts FAQ, word for word (the website shows the same copy)", () => {
    const entries = en.support.faq as Record<string, { q: string; a: string }>;
    expect(Object.keys(entries)).toHaveLength(FAQ.length);
    FAQ.forEach((entry, i) => {
      expect(entries[String(i + 1)]).toEqual({ q: entry.q, a: entry.a });
    });
  });

  it("the Hindi FAQ answers every question in Hindi, with the same numbers as the English", () => {
    const hindi = hi.support.faq as Record<string, { q: string; a: string }>;
    const english = en.support.faq as Record<string, { q: string; a: string }>;
    const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).join(" ");
    for (const n of Object.keys(english)) {
      expect(hindi[n], `faq ${n}`).toBeDefined();
      expect(/[ऀ-ॿ]/.test(hindi[n]!.q), `faq ${n} q is Hindi`).toBe(true);
      expect(/[ऀ-ॿ]/.test(hindi[n]!.a), `faq ${n} a is Hindi`).toBe(true);
      expect(numbers(hindi[n]!.a), `faq ${n} numbers`).toBe(numbers(english[n]!.a));
    }
  });

  it("the withdrawal FAQ no longer says to pick a method you deposited with, in either language", () => {
    expect(en.support.faq["1"].a).toContain("choose Bank, UPI or USDT");
    expect(hi.support.faq["1"].a).toContain("बैंक, UPI या USDT चुनें");
  });
});

describe("Security screen guards (no render tests exist, so the source is checked)", () => {
  // Code only: the doc comments name the very things the guards forbid.
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const security = code("app/(tabs)/account/security.tsx");
  const pin = code("app/(tabs)/account/security-pin.tsx");

  it("never sends the user to the gate's lock screens", () => {
    for (const source of [security, pin]) {
      expect(source).not.toMatch(/["'`]\/lock(-setup)?["'`]/);
      expect(source).not.toMatch(/lock-setup/);
    }
  });

  it("has no two-factor toggles (the server never enforces them)", () => {
    for (const source of [security, pin]) expect(source).not.toMatch(/two-?factor|TwoFa/i);
  });

  it("switches the lock off only behind a verify step: through disableWithBiometric or finishVerify, nowhere else", () => {
    const calls = (source: string) => [...source.matchAll(/\.disable\(\)/g)].length;
    expect(security).toMatch(/disableWithBiometric\(\{[^}]*verify:/);
    expect(calls(security)).toBe(1);
    expect(pin).toMatch(/finishVerify\(next/);
    expect(calls(pin)).toBe(1);
  });

  it("sets a PIN only through the set step, whose decision is pinScreenStep", () => {
    expect(pin).toMatch(/pinScreenStep\(/);
    expect(security).not.toMatch(/setPin\(/);
  });

  it("keeps every PIN count and sign-out in the lock store: the screen reads attempts, it never writes them", () => {
    expect(pin).toMatch(/verifyPin\(/);
    expect(pin).not.toMatch(/attempts:/);
    expect(pin).not.toMatch(/setState/);
  });

  it("pads the pad's screen with the bottom inset", () => {
    expect(pin).toMatch(/paddingBottom: insets\.bottom/);
    expect(security).toMatch(/insets\.bottom/);
  });
});
