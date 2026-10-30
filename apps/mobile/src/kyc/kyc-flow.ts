import { KYC_DOCUMENT_KIND_VALUES, KYC_IDENTITY_FIELDS, type KycDocumentKindValue } from "@asm/contracts";

/** The four photos a submission needs, in the order the flow asks for them. */
export const KYC_DOCS: readonly KycDocumentKindValue[] = KYC_DOCUMENT_KIND_VALUES;
export type KycDocKind = KycDocumentKindValue;
export type KycStep = "details" | KycDocKind | "review";

export type KycGroupId = "details" | "aadhaar" | "pan" | "selfie";
export type KycGroupState = "done" | "current" | "todo";

/** The cards on the verify screen. Aadhaar is one card with two photos (front, then back). */
export const KYC_GROUPS: ReadonlyArray<{ id: KycGroupId; kinds: readonly KycDocKind[] }> = [
  { id: "details", kinds: [] },
  { id: "aadhaar", kinds: ["AADHAAR_FRONT", "AADHAAR_BACK"] },
  { id: "pan", kinds: ["PAN"] },
  { id: "selfie", kinds: ["SELFIE"] },
];

/** True when every identity field the server requires on submit holds something other than whitespace. */
export function detailsComplete(profile: Readonly<Record<string, string | null | undefined>>): boolean {
  return KYC_IDENTITY_FIELDS.every((field) => (profile[field] ?? "").trim() !== "");
}

/** Details first, then the first photo the server does not have yet, then review. */
export function nextKycStep(p: { detailsComplete: boolean; kycDocuments: readonly string[] }): KycStep {
  if (!p.detailsComplete) return "details";
  return KYC_DOCS.find((d) => !p.kycDocuments.includes(d)) ?? "review";
}

/** The card a step belongs to; "review" belongs to none. */
export function stepGroup(step: KycStep): KycGroupId | null {
  if (step === "review") return null;
  if (step === "details") return "details";
  return KYC_GROUPS.find((g) => g.kinds.includes(step))?.id ?? null;
}

/**
 * Each card's state. The card holding the next step is current; the others are done when they have what they
 * need (details filled, all their photos on the server) and todo otherwise. A photo taken out of order, or kept
 * from before a rejection, still shows its card as done.
 */
export function groupStates(p: { detailsComplete: boolean; kycDocuments: readonly string[] }): Record<KycGroupId, KycGroupState> {
  const current = stepGroup(nextKycStep(p));
  const out = {} as Record<KycGroupId, KycGroupState>;
  for (const g of KYC_GROUPS) {
    const complete = g.id === "details" ? p.detailsComplete : g.kinds.every((k) => p.kycDocuments.includes(k));
    out[g.id] = g.id === current ? "current" : complete ? "done" : "todo";
  }
  return out;
}
