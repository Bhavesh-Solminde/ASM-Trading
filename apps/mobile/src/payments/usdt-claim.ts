import { ClaimUsdtPaymentSchema, type ClaimUsdtPaymentInput } from "@asm/contracts";

/** `0x` plus 64 hex characters: the longest transaction hash there is (a BSC hash; a TRON ID is the 64 without the prefix). */
export const TX_HASH_MAX_LENGTH = 66;

/**
 * What was typed or pasted, without the spaces and line breaks a paste carries, capped at the longest hash. Characters
 * are not rewritten: a wrong one must show up as a format error, not be quietly dropped (the hash would then name a
 * different transaction).
 */
export function sanitizeTxHash(text: string): string {
  return text.replace(/\s+/g, "").slice(0, TX_HASH_MAX_LENGTH);
}

/** Why a hash cannot be sent: "required" (empty) or "format" (not 64 hex characters, `0x` optional). Null when it can. */
export function txHashProblem(text: string): "required" | "format" | null {
  const hash = sanitizeTxHash(text);
  if (hash === "") return "required";
  return ClaimUsdtPaymentSchema.safeParse({ txHash: hash }).success ? null : "format";
}

/**
 * The body of `POST /api/deposits/:id/usdt-claim`: the hash and nothing else (no screenshot: the app does not upload
 * one), parsed through the contract the server enforces so it is the bare lowercase hex the server stores. Throws for
 * a hash it would reject.
 */
export function usdtClaimBody(text: string): ClaimUsdtPaymentInput {
  return ClaimUsdtPaymentSchema.parse({ txHash: sanitizeTxHash(text) });
}

/** A stored claim (bare hex) as the user's wallet shows it: a BSC hash with `0x`, a TRON ID bare. */
export function shownTxHash(txHash: string, network: string | null): string {
  return network === "bsc" && !txHash.startsWith("0x") ? `0x${txHash}` : txHash;
}

export interface TxHashHelp {
  placeholder: string;
  hint: string;
  format: string;
}

/** The i18n keys for where to find the hash, the example in the field and the format message, by the deposit's network. */
export function txHashHelp(network: string | null): TxHashHelp {
  if (network === "tron") return { placeholder: "usdtClaim.placeholderTron", hint: "usdtClaim.hintTron", format: "usdtClaim.formatTron" };
  if (network === "bsc") return { placeholder: "usdtClaim.placeholderBsc", hint: "usdtClaim.hintBsc", format: "usdtClaim.formatBsc" };
  return { placeholder: "usdtClaim.placeholder", hint: "usdtClaim.hint", format: "usdtClaim.formatTron" };
}

/** The statuses `POST /api/deposits/:id/usdt-claim` takes a hash for: still open, or just expired. Any other answers 409. */
export function usdtClaimAvailable(status: string): boolean {
  return status === "AWAITING_PAYMENT" || status === "EXPIRED";
}

/**
 * Whether the pay screens offer "submit your transaction": a manual (shared-address) USDT payment that can still take
 * one. A gateway deposit has its own unique address and lands in review by itself, so it never shows the link.
 */
export function usdtClaimEntry(input: { method: string; isGateway: boolean; status: string }): boolean {
  return input.method === "USDT" && !input.isGateway && usdtClaimAvailable(input.status);
}
