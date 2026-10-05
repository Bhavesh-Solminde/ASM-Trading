import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseTatumWebhook, verifyTatumSignature } from "./webhook";

// Tatum's own documented example ("Authenticating Notification Webhooks").
const DOC_SECRET = "c354b83b-d31b-4dda-9bab-d6a67715a1ed";
const DOC_HASH = "WdhYQft+qP8LpYAdeOMncUzIZ7DSUWX9JVSjeGH3F4mCreUxtIpTl2VYigm+qUvkfSQ0lWmTrzADm4mGxSVcxA==";
const DOC_BODY = {
  address: "TJG7iciLGjsib9qhe6U6F7M2vxYJuDjWNM",
  amount: "20",
  counterAddress: "TVf3RVEtzKtMfqQaCAWs9d4HKbC4bZGaWP",
  asset: "TRON",
  blockNumber: 44087791,
  txId: "93442189d7bccbe009f8ab594831ff9d7d258cab712d74a404cd3dccdc4c6d69",
  type: "native",
  tokenId: null,
  chain: "tron-testnet",
  subscriptionType: "ADDRESS_EVENT",
};

describe("verifyTatumSignature", () => {
  it("accepts Tatum's documented example", () => {
    expect(verifyTatumSignature(JSON.stringify(DOC_BODY), DOC_HASH, DOC_SECRET)).toBe(true);
  });

  it("is insensitive to whitespace in the raw body (Tatum hashes JSON.stringify(body))", () => {
    expect(verifyTatumSignature(JSON.stringify(DOC_BODY, null, 2), DOC_HASH, DOC_SECRET)).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, a missing header and non-JSON", () => {
    expect(verifyTatumSignature(JSON.stringify({ ...DOC_BODY, amount: "2000" }), DOC_HASH, DOC_SECRET)).toBe(false);
    expect(verifyTatumSignature(JSON.stringify(DOC_BODY), DOC_HASH, "other")).toBe(false);
    expect(verifyTatumSignature(JSON.stringify(DOC_BODY), null, DOC_SECRET)).toBe(false);
    expect(verifyTatumSignature("not json", DOC_HASH, DOC_SECRET)).toBe(false);
    expect(verifyTatumSignature(JSON.stringify(DOC_BODY), DOC_HASH, "")).toBe(false);
  });

  it("round-trips a signature we compute the same way", () => {
    const body = { address: "0xabc", txId: "0x1", chain: "bsc-testnet" };
    const sig = createHmac("sha512", "k").update(JSON.stringify(body)).digest("base64");
    expect(verifyTatumSignature(JSON.stringify(body), sig, "k")).toBe(true);
  });
});

describe("parseTatumWebhook", () => {
  it("maps chain ids to networks and normalizes EVM fields to lowercase", () => {
    expect(parseTatumWebhook(DOC_BODY)).toEqual({
      address: "TJG7iciLGjsib9qhe6U6F7M2vxYJuDjWNM",
      txId: "93442189d7bccbe009f8ab594831ff9d7d258cab712d74a404cd3dccdc4c6d69",
      chain: "tron-testnet",
      network: "tron",
    });
    expect(
      parseTatumWebhook({ address: "0xAbC", txId: "0xDEF", chain: "bsc-mainnet", subscriptionType: "INCOMING_FUNGIBLE_TX" }),
    ).toEqual({ address: "0xabc", txId: "0xdef", chain: "bsc-mainnet", network: "bsc" });
    expect(parseTatumWebhook({ address: "x", txId: "y", chain: "ethereum-mainnet" })).toMatchObject({ network: null });
  });

  it("returns null for anything missing address/txId/chain", () => {
    expect(parseTatumWebhook(null)).toBeNull();
    expect(parseTatumWebhook({ address: "x", chain: "tron-testnet" })).toBeNull();
    expect(parseTatumWebhook({ address: 1, txId: "y", chain: "tron-testnet" })).toBeNull();
  });
});
