import { describe, expect, it } from "vitest";
import tronTx from "./__fixtures__/tron-tx.json" with { type: "json" };
import tronList from "./__fixtures__/tron-trc20-list.json" with { type: "json" };
import tronBlock from "./__fixtures__/tron-block.json" with { type: "json" };
import { createTronChain, tronBase58ToHex, tronHexToBase58 } from "./tron";
import type { TatumNetworkConfig } from "./config";
import { fakeFetch } from "./test-utils";

const CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const SENDER = "TVF2Mp9QY7FEGTnr3DBpFLobA6jguHyMvi";
const TX = "15b3458c34cb89048696f887953a60c7ec0e6447ff9f02485ad68fcc99240679";

const CFG: TatumNetworkConfig = {
  network: "tron",
  apiKey: "t-test",
  testnet: true,
  xpub: "xpub-tron",
  tokenContract: CONTRACT,
  tokenDecimals: 6,
  webhookUrl: null,
  hmacSecret: null,
};

describe("TRON address conversion", () => {
  it("matches the pairs Tatum itself returns (owner_address / ownerAddressBase58)", () => {
    expect(tronBase58ToHex(SENDER)).toBe("41d3682962027e721c5247a9faf7865fe4a71d5438");
    expect(tronHexToBase58("41d3682962027e721c5247a9faf7865fe4a71d5438")).toBe(SENDER);
    expect(tronBase58ToHex(CONTRACT)).toBe("4142a1e39aefa49290f2b3f9ed688d7cecf86cd6e0");
    // 20-byte form (as in event logs) gets the 0x41 prefix added.
    expect(tronHexToBase58("42a1e39aefa49290f2b3f9ed688d7cecf86cd6e0")).toBe(CONTRACT);
  });

  it("rejects a bad checksum", () => {
    expect(() => tronBase58ToHex("TVF2Mp9QY7FEGTnr3DBpFLobA6jguHyMvj")).toThrow(/checksum/i);
  });
});

describe("createTronChain", () => {
  it("derives an address from the xpub via Tatum", async () => {
    const f = fakeFetch({ "GET /v3/tron/address/xpub-tron/7": { address: "TDTGBGVwuKQ6G3zPDhPCqqGvdfGgVdQREr" } });
    const chain = createTronChain(CFG, f.fetch);
    expect(await chain.deriveAddress(7)).toBe("TDTGBGVwuKQ6G3zPDhPCqqGvdfGgVdQREr");
    expect(f.calls[0]!.headers["x-api-key"]).toBe("t-test");
    expect(f.calls[0]!.url).toBe("https://api.tatum.io/v3/tron/address/xpub-tron/7");
  });

  it("lists incoming tx hashes of OUR token only, de-duplicated", async () => {
    const f = fakeFetch({ [`GET /v3/tron/transaction/account/${CONTRACT}/trc20`]: tronList });
    const chain = createTronChain(CFG, f.fetch);
    // Fixture: two USDT(TG3XX) transfers to the address + one of a different token.
    expect(await chain.listIncomingTxHashes(CONTRACT, 0)).toEqual([
      "15b3458c34cb89048696f887953a60c7ec0e6447ff9f02485ad68fcc99240679",
      "f228232ae18c566e8162a9a9e3a4899a00a03cd4cd90e0f83d7e571c9efe7e57",
    ]);
  });

  it("decodes the Transfer to our address from a real Shasta tx and applies 20-block finality", async () => {
    const routes = (current: number) => ({
      [`GET /v3/tron/transaction/${TX}`]: tronTx,
      "GET /v3/tron/info": { testnet: true, blockNumber: current },
      [`GET /v3/tron/block/${tronTx.blockNumber}`]: tronBlock,
    });
    const notFinal = await createTronChain(CFG, fakeFetch(routes(tronTx.blockNumber + 19)).fetch).verifyTransfer(TX, CONTRACT);
    expect(notFinal).toEqual({
      kind: "ok",
      final: false,
      blockNumber: BigInt(tronTx.blockNumber),
      blockTimestampMs: tronBlock.timestamp,
      transfers: [{ eventIndex: 0, fromAddress: SENDER, rawValue: 1_000_000_000n }],
    });
    const final = await createTronChain(CFG, fakeFetch(routes(tronTx.blockNumber + 20)).fetch).verifyTransfer(TX, CONTRACT);
    expect(final).toMatchObject({ kind: "ok", final: true });
  });

  it("returns no transfers for an address the tx did not pay", async () => {
    const f = fakeFetch({
      [`GET /v3/tron/transaction/${TX}`]: tronTx,
      "GET /v3/tron/info": { blockNumber: tronTx.blockNumber + 100 },
      [`GET /v3/tron/block/${tronTx.blockNumber}`]: tronBlock,
    });
    expect(await createTronChain(CFG, f.fetch).verifyTransfer(TX, SENDER)).toMatchObject({ kind: "ok", transfers: [] });
  });

  it("reports a reverted tx as failed and an unknown tx as not_found", async () => {
    const reverted = { ...tronTx, ret: [{ contractRet: "REVERT" }] };
    expect(
      await createTronChain(CFG, fakeFetch({ [`GET /v3/tron/transaction/${TX}`]: reverted }).fetch).verifyTransfer(TX, CONTRACT),
    ).toEqual({ kind: "failed" });
    const missing = fakeFetch({ [`GET /v3/tron/transaction/${TX}`]: { status: 404, body: { message: "not found" } } });
    expect(await createTronChain(CFG, missing.fetch).verifyTransfer(TX, CONTRACT)).toEqual({ kind: "not_found" });
  });

  it("treats a tx with no block yet as not final and transferless", async () => {
    const pending = { ...tronTx, blockNumber: undefined };
    const f = fakeFetch({ [`GET /v3/tron/transaction/${TX}`]: pending });
    expect(await createTronChain(CFG, f.fetch).verifyTransfer(TX, CONTRACT)).toEqual({ kind: "not_found" });
  });
});
