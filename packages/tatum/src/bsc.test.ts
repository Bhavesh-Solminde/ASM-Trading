import { describe, expect, it } from "vitest";
import receipt from "./__fixtures__/bsc-receipt.json" with { type: "json" };
import meta from "./__fixtures__/bsc-meta.json" with { type: "json" };
import { BSC_MAX_LOOKBACK_BLOCKS, createBscChain } from "./bsc";
import type { TatumNetworkConfig } from "./config";
import { fakeFetch, type FakeRoutes } from "./test-utils";

const CONTRACT = "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd";
const CFG: TatumNetworkConfig = {
  network: "bsc",
  apiKey: "t-test",
  testnet: true,
  xpub: "xpub-bsc",
  tokenContract: CONTRACT,
  tokenDecimals: 18,
  webhookUrl: null,
  hmacSecret: null,
};
const RPC = "POST https://bsc-testnet.gateway.tatum.io/";
const RECEIPT_BLOCK = BigInt(receipt.blockNumber);

function rpcRoutes(results: Record<string, (params: unknown[]) => unknown>): FakeRoutes {
  return {
    [RPC]: (body: unknown) => {
      const { method, params, id } = body as { method: string; params: unknown[]; id: number };
      const handler = results[method];
      if (!handler) throw new Error(`unexpected rpc ${method}`);
      return { jsonrpc: "2.0", id, result: handler(params) };
    },
  };
}

const hex = (n: bigint) => `0x${n.toString(16)}`;

describe("createBscChain", () => {
  it("derives via Tatum and lowercases the address", async () => {
    const f = fakeFetch({ "GET /v3/bsc/address/xpub-bsc/3": { address: "0xAbCdEF0123456789aBcDeF0123456789AbCdEf01" } });
    expect(await createBscChain(CFG, f.fetch).deriveAddress(3)).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
  });

  it("decodes only the Transfer of OUR token to OUR address from a real receipt", async () => {
    const routes = (finalized: bigint) =>
      rpcRoutes({
        eth_getTransactionReceipt: () => receipt,
        eth_getBlockByNumber: (p) =>
          p[0] === "finalized" ? { number: hex(finalized) } : { number: receipt.blockNumber, timestamp: hex(BigInt(meta.blockTimestamp)) },
      });
    const pending = await createBscChain(CFG, fakeFetch(routes(RECEIPT_BLOCK - 1n)).fetch).verifyTransfer(meta.txHash, meta.to);
    expect(pending).toEqual({
      kind: "ok",
      final: false,
      blockNumber: RECEIPT_BLOCK,
      blockTimestampMs: meta.blockTimestamp * 1000,
      transfers: [
        { eventIndex: 0x1e, fromAddress: "0xcaf8908b9bf1d577008bef7643f2e8db13c52fc1", rawValue: BigInt(meta.value) },
      ],
    });
    const final = await createBscChain(CFG, fakeFetch(routes(RECEIPT_BLOCK)).fetch).verifyTransfer(meta.txHash, meta.to);
    expect(final).toMatchObject({ kind: "ok", final: true });
  });

  it("maps status 0 to failed and a missing receipt to not_found", async () => {
    const failed = rpcRoutes({ eth_getTransactionReceipt: () => ({ ...receipt, status: "0x0" }) });
    expect(await createBscChain(CFG, fakeFetch(failed).fetch).verifyTransfer(meta.txHash, meta.to)).toEqual({ kind: "failed" });
    const missing = rpcRoutes({ eth_getTransactionReceipt: () => null });
    expect(await createBscChain(CFG, fakeFetch(missing).fetch).verifyTransfer(meta.txHash, meta.to)).toEqual({ kind: "not_found" });
  });

  it("lists incoming tx hashes with eth_getLogs, capping the lookback window", async () => {
    let seen: Record<string, unknown> | null = null;
    const latest = 50_000_000n;
    const f = fakeFetch(
      rpcRoutes({
        eth_blockNumber: () => hex(latest),
        eth_getLogs: (p) => {
          seen = p[0] as Record<string, unknown>;
          return [
            { transactionHash: "0xAA", removed: false },
            { transactionHash: "0xaa", removed: false },
            { transactionHash: "0xbb", removed: true },
          ];
        },
      }),
    );
    const hashes = await createBscChain(CFG, f.fetch).listIncomingTxHashes("0xABCDEF0000000000000000000000000000000001", 0);
    expect(hashes).toEqual(["0xaa"]);
    expect(seen).toEqual({
      address: CONTRACT,
      fromBlock: hex(latest - BigInt(BSC_MAX_LOOKBACK_BLOCKS)),
      toBlock: hex(latest),
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        null,
        "0x000000000000000000000000abcdef0000000000000000000000000000000001",
      ],
    });
    expect(BSC_MAX_LOOKBACK_BLOCKS).toBeLessThanOrEqual(9_900);
  });

  it("uses a short window for a recent deposit", async () => {
    let from = "";
    const latest = 1_000_000n;
    const f = fakeFetch(
      rpcRoutes({
        eth_blockNumber: () => hex(latest),
        eth_getLogs: (p) => {
          from = (p[0] as { fromBlock: string }).fromBlock;
          return [];
        },
      }),
    );
    await createBscChain(CFG, f.fetch).listIncomingTxHashes("0x0000000000000000000000000000000000000001", Date.now() - 60_000);
    const window = latest - BigInt(from);
    expect(window).toBeGreaterThan(100n); // ≥ 60s / 0.45s plus margin
    expect(window).toBeLessThan(1_000n);
  });

  it("surfaces JSON-RPC errors as TatumError", async () => {
    const f = fakeFetch({ [RPC]: { jsonrpc: "2.0", id: 1, error: { code: -1, message: "boom" } } });
    await expect(createBscChain(CFG, f.fetch).verifyTransfer(meta.txHash, meta.to)).rejects.toThrow(/boom/);
  });
});
