import { describe, expect, it } from "vitest";
import { checkTatumKeyNetwork } from "./network-check";
import { TatumError } from "./http";
import { fakeFetch } from "./test-utils";

const info = (body: unknown) => fakeFetch({ "GET /v3/tron/info": body }).fetch;

describe("checkTatumKeyNetwork", () => {
  it("is ok when the key serves the configured network", async () => {
    expect(await checkTatumKeyNetwork({ apiKey: "t-k", testnet: false }, info({ testnet: false, blockNumber: 86852138 }))).toBe("ok");
    expect(await checkTatumKeyNetwork({ apiKey: "t-k", testnet: true }, info({ testnet: true, blockNumber: 1 }))).toBe("ok");
  });

  it("reports a mismatch either way round", async () => {
    expect(await checkTatumKeyNetwork({ apiKey: "t-k", testnet: false }, info({ testnet: true }))).toBe("mismatch");
    expect(await checkTatumKeyNetwork({ apiKey: "t-k", testnet: true }, info({ testnet: false }))).toBe("mismatch");
  });

  it("throws (unknown, not a match) when Tatum gives no answer", async () => {
    await expect(checkTatumKeyNetwork({ apiKey: "t-k", testnet: false }, info({ blockNumber: 1 }))).rejects.toThrow(TatumError);
    await expect(checkTatumKeyNetwork({ apiKey: "t-k", testnet: false }, info({ status: 401, body: { message: "bad key" } }))).rejects.toThrow(TatumError);
  });
});
