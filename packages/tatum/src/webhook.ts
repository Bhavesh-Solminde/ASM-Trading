import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayNetwork } from "./config";

/**
 * Tatum signs each webhook with `x-payload-hash` = base64(HMAC-SHA512(secret,
 * JSON.stringify(body))) — over its own re-serialization of the body, so we
 * re-serialize the parsed body the same way rather than hashing raw bytes.
 * Constant-time compare. Any parse problem is simply "not verified".
 */
export function verifyTatumSignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const expected = createHmac("sha512", secret).update(JSON.stringify(body)).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.trim(), "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface TatumWebhookEvent {
  /** The watched address (our deposit address). */
  address: string;
  txId: string;
  /** Tatum chain id, e.g. "tron-testnet", "bsc-mainnet". */
  chain: string;
  network: GatewayNetwork | null;
}

/**
 * Extracts the only fields we use from a webhook body. They are a WAKE-UP
 * signal, never evidence: amount/sender/contract in the body are ignored and
 * re-derived from the chain (see processor.ts).
 */
export function parseTatumWebhook(body: unknown): TatumWebhookEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const { address, txId, chain } = body as Record<string, unknown>;
  if (typeof address !== "string" || typeof txId !== "string" || typeof chain !== "string") return null;
  if (!address || !txId || !chain) return null;
  const network: GatewayNetwork | null = chain.startsWith("tron-") ? "tron" : chain.startsWith("bsc-") ? "bsc" : null;
  // EVM hex is case-insensitive and stored lowercase; TRON base58 is case-sensitive.
  const evm = network === "bsc";
  return {
    address: evm ? address.toLowerCase() : address,
    txId: evm ? txId.toLowerCase() : txId,
    chain,
    network,
  };
}
