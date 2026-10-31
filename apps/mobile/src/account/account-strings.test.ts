import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/i18n/en.json";
import hi from "@/i18n/hi.json";
import { flattenKeys } from "@/i18n/keys";
import { kycTag, lockValueKey } from "./hub-model";
import { LANGUAGE_OPTIONS } from "./language-model";
import { identityRows, nicknameProblem } from "./profile-model";

const have = (locale: object) => new Set(flattenKeys(locale as Record<string, unknown>));

const KYC_STATUSES = ["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"] as const;
const LOCKS = [
  { enabled: true, method: "biometric" as const },
  { enabled: true, method: "pin" as const },
  { enabled: false, method: null },
];

/** Every key an Account model hands to a screen (the screens call `t(model.key)`, which no literal scan can see). */
const modelKeys = [
  ...KYC_STATUSES.map((s) => kycTag(s).labelKey),
  ...LOCKS.map(lockValueKey),
  ...LANGUAGE_OPTIONS.map((o) => o.labelKey),
  ...identityRows({ firstName: null, lastName: null, dateOfBirth: null, aadhaar: null, pan: null, address: null, country: null }).map((r) => r.labelKey),
  nicknameProblem("") as string,
];

const root = join(__dirname, "..", "..");
const files = [
  "app/(tabs)/account/index.tsx",
  "app/(tabs)/account/profile.tsx",
  "app/(tabs)/account/language.tsx",
  "app/(tabs)/account/notifications.tsx",
  "src/account/useDemoReset.ts",
  "src/account/demo-reset.ts",
  "app/(tabs)/account/currency.tsx",
  "src/account/useCurrencySwitch.ts",
  "src/account/currency-switch.ts",
];
const literal = files.flatMap((f) => [...readFileSync(join(root, f), "utf8").matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)].map((m) => m[1] as string));

describe("Account strings", () => {
  it("finds the keys it is meant to check", () => {
    expect(modelKeys.length).toBeGreaterThan(10);
    expect(literal.length).toBeGreaterThan(30);
  });
  for (const [name, locale] of [["English", en], ["Hindi", hi]] as const) {
    it(`exist in ${name}`, () => {
      const known = have(locale);
      expect([...new Set([...modelKeys, ...literal])].filter((k) => !known.has(k))).toEqual([]);
    });
  }
  it("give the language screen no hard-coded language names: they come from lang.*", () => {
    expect(en.lang.en).toBe("English");
    expect(hi.lang.hi).toBe("हिन्दी");
  });
});
