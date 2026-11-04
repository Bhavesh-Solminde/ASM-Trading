import { ClaimUtrSchema, type ClaimUtrInput } from "@asm/contracts";

/** The longest reference the server takes (`ClaimUtrSchema`: 9 to 22 digits). */
export const UTR_MAX_LENGTH = 22;

/** Whatever the user typed or pasted, as digits only, capped at the longest reference. Latin digits only: that is all the server takes. */
export function sanitizeUtr(text: string): string {
  return text.replace(/[^0-9]/g, "").slice(0, UTR_MAX_LENGTH);
}

/** Why a reference cannot be sent, as a key under `claim.*`: "required" (empty) or "format" (not 9 to 22 digits). Null when it can. */
export function utrProblem(text: string): "required" | "format" | null {
  if (text.trim() === "") return "required";
  return ClaimUtrSchema.safeParse({ utr: text }).success ? null : "format";
}

/**
 * The body of `POST /api/deposits/:id/claim`: the UTR and nothing else (no screenshot: the app does not upload one).
 * Parsed through the contract the server enforces; throws for a reference it would reject.
 */
export function claimBody(text: string): ClaimUtrInput {
  return ClaimUtrSchema.parse({ utr: sanitizeUtr(text) });
}
