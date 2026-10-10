import { describe, expect, it } from "vitest";
import { isTatumProvider, listTatumEnabledNetworks, readTatumConfig, usdtProviderFor } from "./config";

const BASE = {
  TATUM_API_KEY: "t-abc",
  TATUM_NETWORK: "testnet",
  TATUM_TRON_XPUB: "xpub6TronTest",
  TATUM_TRON_USDT_CONTRACT: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
  TATUM_BSC_XPUB: "xpub6BscTest",
  TATUM_BSC_USDT_CONTRACT: "0x337610D27C682E347C9CD60BD4B3B107C9D34DDD",
  TATUM_BSC_USDT_DECIMALS: "18",
};

describe("isTatumProvider", () => {
  it("defaults to tatum; only an explicit 'manual' opts out", () => {
    expect(isTatumProvider({})).toBe(true);
    expect(isTatumProvider({ USDT_DEPOSIT_PROVIDER: "tatum" })).toBe(true);
    expect(isTatumProvider({ USDT_DEPOSIT_PROVIDER: "bogus" })).toBe(true);
    expect(isTatumProvider({ USDT_DEPOSIT_PROVIDER: "manual" })).toBe(false);
  });
});

describe("usdtProviderFor", () => {
  it("follows USDT_DEPOSIT_PROVIDER unless the network has its own override", () => {
    expect(usdtProviderFor("tron", {})).toBe("tatum");
    expect(usdtProviderFor("bsc", { USDT_DEPOSIT_PROVIDER: "manual" })).toBe("manual");
    const split = { USDT_DEPOSIT_PROVIDER: "tatum", USDT_TRON_PROVIDER: "manual" };
    expect(usdtProviderFor("tron", split)).toBe("manual");
    expect(usdtProviderFor("bsc", split)).toBe("tatum");
    expect(usdtProviderFor("bsc", { USDT_DEPOSIT_PROVIDER: "manual", USDT_BSC_PROVIDER: "tatum" })).toBe("tatum");
  });

  it("ignores an unrecognised override value and falls back to the global provider", () => {
    expect(usdtProviderFor("tron", { USDT_DEPOSIT_PROVIDER: "manual", USDT_TRON_PROVIDER: "Manual " })).toBe("manual");
    expect(usdtProviderFor("tron", { USDT_TRON_PROVIDER: "bogus" })).toBe("tatum");
  });
});

describe("readTatumConfig", () => {
  it("returns a complete TRON config (USDT 6 decimals)", () => {
    expect(readTatumConfig("tron", BASE)).toEqual({
      network: "tron",
      apiKey: "t-abc",
      testnet: true,
      xpub: "xpub6TronTest",
      tokenContract: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
      tokenDecimals: 6,
      webhookUrl: null,
      hmacSecret: null,
    });
  });

  it("lowercases the BSC contract and reads explicit decimals", () => {
    expect(readTatumConfig("bsc", BASE)).toMatchObject({
      network: "bsc",
      tokenContract: "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd",
      tokenDecimals: 18,
    });
  });

  it("is null when any required value is missing or malformed", () => {
    expect(readTatumConfig("tron", { ...BASE, TATUM_API_KEY: "" })).toBeNull();
    expect(readTatumConfig("tron", { ...BASE, TATUM_NETWORK: "" })).toBeNull();
    expect(readTatumConfig("tron", { ...BASE, TATUM_TRON_XPUB: "" })).toBeNull();
    expect(readTatumConfig("tron", { ...BASE, TATUM_TRON_USDT_CONTRACT: "0xnot-tron" })).toBeNull();
    expect(readTatumConfig("bsc", { ...BASE, TATUM_BSC_USDT_DECIMALS: "" })).toBeNull();
    expect(readTatumConfig("bsc", { ...BASE, TATUM_BSC_USDT_CONTRACT: "TG3XX" })).toBeNull();
  });

  it("takes the network from TATUM_NETWORK alone — Tatum issues t- prefixed keys for BOTH networks", () => {
    // Verified live 2026-10-05: a real mainnet key starting with "t-" answered
    // /v3/tron/info with testnet:false. Key/network agreement is checked
    // against Tatum at runtime instead (checkTatumKeyNetwork).
    expect(readTatumConfig("tron", { ...BASE, TATUM_NETWORK: "mainnet" })).toMatchObject({ testnet: false, apiKey: "t-abc" });
    expect(readTatumConfig("tron", { ...BASE, TATUM_API_KEY: "other-key" })).toMatchObject({ testnet: true });
    expect(readTatumConfig("tron", { ...BASE, TATUM_NETWORK: "" })).toBeNull();
  });

  it("requires an HMAC secret whenever a webhook URL is configured", () => {
    expect(readTatumConfig("tron", { ...BASE, TATUM_WEBHOOK_URL: "https://x.test/api/webhooks/tatum" })).toBeNull();
    expect(
      readTatumConfig("tron", {
        ...BASE,
        TATUM_WEBHOOK_URL: "https://x.test/api/webhooks/tatum",
        TATUM_WEBHOOK_HMAC_SECRET: "s3cret",
      }),
    ).toMatchObject({ webhookUrl: "https://x.test/api/webhooks/tatum", hmacSecret: "s3cret" });
    expect(readTatumConfig("tron", { ...BASE, TATUM_WEBHOOK_URL: "http://insecure.test/hook", TATUM_WEBHOOK_HMAC_SECRET: "s" })).toBeNull();
  });
});

describe("listTatumEnabledNetworks", () => {
  it("lists only fully configured networks, and none under the manual provider", () => {
    expect(listTatumEnabledNetworks(BASE)).toEqual(["tron", "bsc"]);
    expect(listTatumEnabledNetworks({ ...BASE, TATUM_BSC_XPUB: "" })).toEqual(["tron"]);
    expect(listTatumEnabledNetworks({ ...BASE, USDT_DEPOSIT_PROVIDER: "manual" })).toEqual([]);
  });

  it("drops a network whose own provider is manual (TRON direct, BSC on the gateway)", () => {
    expect(listTatumEnabledNetworks({ ...BASE, USDT_TRON_PROVIDER: "manual" })).toEqual(["bsc"]);
    expect(listTatumEnabledNetworks({ ...BASE, USDT_DEPOSIT_PROVIDER: "manual", USDT_BSC_PROVIDER: "tatum" })).toEqual(["bsc"]);
  });
});
