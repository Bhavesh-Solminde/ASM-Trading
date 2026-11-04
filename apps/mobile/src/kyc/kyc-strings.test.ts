import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/i18n/en.json";
import hi from "@/i18n/hi.json";
import { flattenKeys } from "@/i18n/keys";
import { DETAILS_ERROR_KEYS } from "./details-model";
import { captureHintKey, captureTitleKey } from "./capture-model";
import { KYC_DOCS, KYC_GROUPS } from "./kyc-flow";
import { KYC_STEP_CTA_KEYS, verifyCards } from "./verify-model";

const have = (locale: object) => new Set(flattenKeys(locale as Record<string, unknown>));

/** Every i18n key the KYC models hand to a screen must exist in both languages (a missing key renders as its own name). */
describe("KYC strings", () => {
  const keys = [
    ...Object.values(KYC_STEP_CTA_KEYS),
    ...Object.values(DETAILS_ERROR_KEYS),
    "kyc.err.underage",
    ...KYC_DOCS.flatMap((k) => [captureTitleKey(k), captureHintKey(k)]),
    ...verifyCards({ detailsComplete: false, kycDocuments: [] }).flatMap((c) => [c.titleKey, c.subtitleKey]),
    ...KYC_GROUPS.map((g) => `kyc.card.${g.id}.title`),
  ];
  it("exist in English", () => {
    expect(keys.filter((k) => !have(en).has(k))).toEqual([]);
  });
  it("exist in Hindi", () => {
    expect(keys.filter((k) => !have(hi).has(k))).toEqual([]);
  });
});

/** The keys the KYC screens write out literally, `t("kyc.x")` (the dynamic ones are covered above). */
describe("KYC screens' literal strings", () => {
  const root = join(__dirname, "..", "..");
  const files = ["src/kyc/CaptureScreen.tsx", "src/kyc/DetailsForm.tsx", "src/kyc/StepCards.tsx", "src/kyc/submit-photo.ts", "src/kyc/upload-model.ts", "src/kyc/verify-model.ts", "app/(tabs)/account/verify.tsx", "app/(tabs)/account/kyc-details.tsx", "app/(tabs)/account/kyc-camera.tsx"];
  const used = new Set(files.flatMap((f) => [...readFileSync(join(root, f), "utf8").matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)].map((m) => m[1] as string)));
  // A timeout key is passed to `kycRequestErrorText` as a string argument rather than to `t(...)` directly.
  for (const f of files) for (const m of readFileSync(join(root, f), "utf8").matchAll(/"(kyc\.(?:submitTimedOut|saveTimedOut))"/g)) used.add(m[1] as string);
  it("finds the keys it is meant to check", () => {
    expect(used.size).toBeGreaterThan(25);
  });
  it("exist in English and in Hindi", () => {
    expect([...used].filter((k) => !have(en).has(k))).toEqual([]);
    expect([...used].filter((k) => !have(hi).has(k))).toEqual([]);
  });
});
