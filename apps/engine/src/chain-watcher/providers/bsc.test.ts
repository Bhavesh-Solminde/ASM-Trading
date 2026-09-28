import { afterEach, describe, expect, it, vi } from "vitest";
import { createBscProvider } from "./bsc";
import { TRANSFER_TOPIC } from "../evm-codec";

const RPC_URL = "https://rpc.example.test/key-in-path";
const CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
const TO = "0x1111111111111111111111111111111111111111";
const FROM = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const TX = `0x${"ab".repeat(32)}`;

function pad(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}
function word(n: bigint): string {
  return `0x${n.toString(16).padStart(64, "0")}`;
}
function rpcResult(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
}
function stubFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}
function sentBody(fn: ReturnType<typeof vi.fn>, call = 0): { method: string; params: unknown[] } {
  const init = fn.mock.calls[call]![1] as RequestInit;
  return JSON.parse(init.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBscProvider", () => {
  it("requires the RPC URL from the caller — no built-in default", () => {
    expect(() => createBscProvider({ rpcUrl: "" })).toThrow();
  });

  it("getChainId/getLatestBlockNumber parse hex quantities (POST JSON-RPC to the configured URL)", async () => {
    const fetchFn = stubFetch(rpcResult("0x61"), rpcResult("0x3a8f2c1"));
    const p = createBscProvider({ rpcUrl: RPC_URL });

    expect(await p.getChainId()).toBe(97);
    expect(await p.getLatestBlockNumber()).toBe(0x3a8f2c1n);

    expect(fetchFn.mock.calls[0]![0]).toBe(RPC_URL);
    expect((fetchFn.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(sentBody(fetchFn, 0).method).toBe("eth_chainId");
    expect(sentBody(fetchFn, 1).method).toBe("eth_blockNumber");
  });

  it("getFinalizedBlockNumber reads eth_getBlockByNumber('finalized')", async () => {
    const fetchFn = stubFetch(rpcResult({ number: "0x100", timestamp: "0x5" }));
    const p = createBscProvider({ rpcUrl: RPC_URL });
    expect(await p.getFinalizedBlockNumber()).toBe(256n);
    expect(sentBody(fetchFn).params).toEqual(["finalized", false]);
  });

  it("getTokenDecimals eth_calls decimals() and decodes the uint256 word", async () => {
    const fetchFn = stubFetch(rpcResult(word(18n)));
    const p = createBscProvider({ rpcUrl: RPC_URL });
    expect(await p.getTokenDecimals(CONTRACT)).toBe(18);
    expect(sentBody(fetchFn).params).toEqual([{ to: CONTRACT, data: "0x313ce567" }, "latest"]);
  });

  it("getTransferLogs filters by contract + padded `to` topic and decodes padded topics and an 18-decimal value exactly", async () => {
    const value = 12_345_670_000_000_000_000_001n; // > 2^53, 18dp: 12345.670000000000000001 USDT
    const fetchFn = stubFetch(
      rpcResult([
        {
          address: CONTRACT,
          transactionHash: TX.toUpperCase().replace("0X", "0x"),
          logIndex: "0x1f",
          blockNumber: "0x2a",
          topics: [TRANSFER_TOPIC, pad(FROM.toUpperCase().replace("0X", "0x")), pad(TO)],
          data: word(value),
          removed: false,
        },
        {
          address: CONTRACT,
          transactionHash: TX,
          logIndex: "0x0",
          blockNumber: "0x2b",
          topics: [TRANSFER_TOPIC, pad(FROM), pad(TO)],
          data: word(1n),
          removed: true,
        },
      ]),
    );
    const p = createBscProvider({ rpcUrl: RPC_URL });

    const logs = await p.getTransferLogs({ tokenContract: CONTRACT, toAddress: TO, fromBlock: 16n, toBlock: 4096n });

    expect(sentBody(fetchFn)).toMatchObject({
      method: "eth_getLogs",
      params: [{ address: CONTRACT, fromBlock: "0x10", toBlock: "0x1000", topics: [TRANSFER_TOPIC, null, pad(TO)] }],
    });
    expect(logs).toEqual([
      { txHash: TX, logIndex: 31, blockNumber: 42n, fromAddress: FROM, toAddress: TO, rawValue: value, removed: false },
      { txHash: TX, logIndex: 0, blockNumber: 43n, fromAddress: FROM, toAddress: TO, rawValue: 1n, removed: true },
    ]);
  });

  it("a malformed log fails the whole call rather than being silently skipped", async () => {
    stubFetch(rpcResult([{ transactionHash: TX, logIndex: "0x0", blockNumber: "0x1", topics: [TRANSFER_TOPIC, pad(FROM), pad(TO)], data: "0x12" }]));
    const p = createBscProvider({ rpcUrl: RPC_URL });
    await expect(p.getTransferLogs({ tokenContract: CONTRACT, toAddress: TO, fromBlock: 1n, toBlock: 2n })).rejects.toThrow();
  });

  it("a JSON-RPC error object throws (e.g. -32005 limit exceeded)", async () => {
    stubFetch(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "limit exceeded" } }), { status: 200 }));
    const p = createBscProvider({ rpcUrl: RPC_URL });
    await expect(p.getTransferLogs({ tokenContract: CONTRACT, toAddress: TO, fromBlock: 1n, toBlock: 2n })).rejects.toThrow(/-32005/);
  });

  it("HTTP 429/5xx, a network error, and malformed JSON all throw", async () => {
    stubFetch(
      new Response("rate limited", { status: 429 }),
      new Response("bad gateway", { status: 502 }),
      new TypeError("fetch failed"),
      new Response("<html>", { status: 200 }),
    );
    const p = createBscProvider({ rpcUrl: RPC_URL });
    await expect(p.getLatestBlockNumber()).rejects.toThrow(/429/);
    await expect(p.getLatestBlockNumber()).rejects.toThrow(/502/);
    await expect(p.getLatestBlockNumber()).rejects.toThrow(/fetch failed/);
    await expect(p.getLatestBlockNumber()).rejects.toThrow(/malformed JSON/);
  });

  it("getReceipt returns null when the node has no receipt", async () => {
    stubFetch(rpcResult(null));
    const p = createBscProvider({ rpcUrl: RPC_URL });
    expect(await p.getReceipt(TX)).toBeNull();
  });

  it("getReceipt decodes status, block number and logs (lowercased)", async () => {
    stubFetch(
      rpcResult({
        status: "0x1",
        blockNumber: "0x2a",
        logs: [{ logIndex: "0x3", address: CONTRACT.toUpperCase().replace("0X", "0x"), topics: [TRANSFER_TOPIC, pad(FROM), pad(TO)], data: word(5n) }],
      }),
    );
    const p = createBscProvider({ rpcUrl: RPC_URL });
    expect(await p.getReceipt(TX)).toEqual({
      status: 1,
      blockNumber: 42n,
      logs: [{ logIndex: 3, address: CONTRACT, topics: [TRANSFER_TOPIC, pad(FROM), pad(TO)], data: word(5n) }],
    });
  });

  it("getBlockTimestampMs converts seconds to ms; a null block throws", async () => {
    stubFetch(rpcResult({ number: "0x2a", timestamp: "0x6553f100" }), rpcResult(null));
    const p = createBscProvider({ rpcUrl: RPC_URL });
    expect(await p.getBlockTimestampMs(42n)).toBe(0x6553f100 * 1000);
    await expect(p.getBlockTimestampMs(43n)).rejects.toThrow();
  });
});
