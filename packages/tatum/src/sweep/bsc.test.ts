import { Transaction } from "ethers";
import { describe, expect, it } from "vitest";
import type { TatumNetworkConfig } from "../config";
import { fakeFetch, type FakeRoutes } from "../test-utils";
import { SELECTOR_TRANSFER, transferParams } from "./abi";
import { createBscSweeper } from "./bsc";
import { signerFromPrivateKey } from "./keys";

const TOKEN = "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd";
const TREASURY = "0x15e770a42b41f2606538505839042ddfebacb590";
const CFG: TatumNetworkConfig = {
  network: "bsc",
  apiKey: "t-test",
  testnet: true,
  xpub: "xpub-bsc",
  tokenContract: TOKEN,
  tokenDecimals: 18,
  webhookUrl: null,
  hmacSecret: null,
};
const SIGNER = signerFromPrivateKey("bsc", "22".repeat(32));
const RPC = "POST https://bsc-testnet.gateway.tatum.io/";
const GWEI = 1_000_000_000n;

function rpc(overrides: Record<string, (params: unknown[]) => unknown> = {}) {
  const sent: string[] = [];
  const handlers: Record<string, (params: unknown[]) => unknown> = {
    eth_chainId: () => "0x61",
    eth_gasPrice: () => `0x${(GWEI / 10n).toString(16)}`,
    eth_estimateGas: () => "0xc350", // 50 000
    eth_getTransactionCount: () => "0x7",
    eth_sendRawTransaction: ([raw]) => {
      sent.push(raw as string);
      return Transaction.from(raw as string).hash;
    },
    eth_getBalance: () => "0x0",
    ...overrides,
  };
  const routes: FakeRoutes = {
    [`GET /v3/blockchain/token/balance/BSC/${TOKEN}/${SIGNER.address}`]: { balance: (42n * 10n ** 18n).toString() },
    [RPC]: (body: unknown) => {
      const { method, params, id } = body as { method: string; params: unknown[]; id: number };
      const h = handlers[method];
      if (!h) throw new Error(`unexpected rpc ${method}`);
      return { jsonrpc: "2.0", id, result: h(params) };
    },
  };
  return { ...fakeFetch(routes), sent };
}

describe("createBscSweeper", () => {
  it("reads the raw token balance from Tatum's REST endpoint (eth_call is paid-plan only)", async () => {
    const f = rpc();
    expect(await createBscSweeper(CFG, f.fetch).tokenBalance(SIGNER.address)).toBe(42n * 10n ** 18n);
    expect(f.calls.some((c) => (c.body as { method?: string } | undefined)?.method === "eth_call")).toBe(false);
  });

  it("quotes gasLimit = estimate + 25% at the current gas price; the gas wallet pays a plain 21k transfer", async () => {
    const q = await createBscSweeper(CFG, rpc().fetch).quoteSweep(SIGNER.address, TREASURY, 5n);
    expect(q.gasLimit).toBe(62_500n);
    expect(q.gasPrice).toBe(GWEI / 10n);
    expect(q.requiredNative).toBe(62_500n * (GWEI / 10n));
    expect(q.topUpOverhead).toBe(21_000n * (GWEI / 10n));
  });

  it("refuses a gas price above the cap", async () => {
    const f = rpc({ eth_gasPrice: () => `0x${(11n * GWEI).toString(16)}` });
    await expect(createBscSweeper(CFG, f.fetch).quoteSweep(SIGNER.address, TREASURY, 5n)).rejects.toThrow(/gas price/);
  });

  it("signs locally a transfer of exactly the quoted call, pinned to chain 97", async () => {
    const f = rpc();
    const quote = { requiredNative: 0n, topUpOverhead: 0n, gasLimit: 62_500n, gasPrice: GWEI / 10n, note: "" };
    const hash = await createBscSweeper(CFG, f.fetch).sendToken(SIGNER, TREASURY, 123n, quote);
    const tx = Transaction.from(f.sent[0]!);
    expect(hash).toBe(tx.hash!.toLowerCase());
    expect(tx.from!.toLowerCase()).toBe(SIGNER.address);
    expect({ chainId: tx.chainId, nonce: tx.nonce, gasLimit: tx.gasLimit, gasPrice: tx.gasPrice, value: tx.value, to: tx.to!.toLowerCase() }).toEqual({
      chainId: 97n,
      nonce: 7,
      gasLimit: 62_500n,
      gasPrice: GWEI / 10n,
      value: 0n,
      to: TOKEN,
    });
    expect(tx.data).toBe(`0x${SELECTOR_TRANSFER}${transferParams(TREASURY, 123n)}`);
  });

  it("refuses to sign when the gateway reports the wrong chain", async () => {
    const f = rpc({ eth_chainId: () => "0x38" }); // 56 = mainnet, but the config says testnet
    await expect(createBscSweeper(CFG, f.fetch).sendNative(SIGNER, TREASURY, 1n)).rejects.toThrow(/chain 56/);
    expect(f.sent).toHaveLength(0);
  });

  it("fails loudly if the gateway returns a different tx hash than we signed", async () => {
    const f = rpc({ eth_sendRawTransaction: () => `0x${"ee".repeat(32)}` });
    await expect(createBscSweeper(CFG, f.fetch).sendNative(SIGNER, TREASURY, 1n)).rejects.toThrow(/returned hash/);
  });

  it("waitForTx maps the receipt status", async () => {
    const wait = (receipt: unknown) => createBscSweeper(CFG, rpc({ eth_getTransactionReceipt: () => receipt }).fetch, { pollMs: 1 }).waitForTx("0xab", 0);
    expect(await wait({ status: "0x1", blockNumber: "0x10" })).toBe("success");
    expect(await wait({ status: "0x0", blockNumber: "0x10" })).toBe("failed");
    expect(await wait(null)).toBe("pending");
  });
});
