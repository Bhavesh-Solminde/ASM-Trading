import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountsForUser, createUsdtDepositIntent, prisma } from "@asm/db";
import { resolveBscConfig, startBscWatcher } from "./bsc-runner";
import { TRANSFER_TOPIC } from "./evm-codec";
import type { EvmChainProvider, EvmReceipt, EvmTransferLog } from "./types";

const ENV_KEYS = [
  "USDT_BSC_CHAIN_ID",
  "USDT_BSC_RPC_URL",
  "USDT_BSC_RECEIVING_ADDRESS",
  "USDT_BSC_TOKEN_CONTRACT",
  "USDT_BSC_TOKEN_DECIMALS",
  "USDT_BSC_MAX_BLOCK_RANGE",
  "USDT_BSC_INITIAL_LOOKBACK_BLOCKS",
  "USDT_WATCHER_TICK_INTERVAL_MS",
  "USDT_WATCHER_IDLE_INTERVAL_MS",
  "USDT_AUTO_CONFIRM_ENABLED",
] as const;
type EnvKey = (typeof ENV_KEYS)[number];
const savedEnv: Record<string, string | undefined> = {};

const hex = (bytes: number) => `0x${randomBytes(bytes).toString("hex")}`;
const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const usedContracts: string[] = [];

function setEnv(vars: Partial<Record<EnvKey, string | undefined>>): void {
  for (const key of ENV_KEYS) {
    if (vars[key] !== undefined) process.env[key] = vars[key];
    else delete process.env[key];
  }
}

function configuredEnv(overrides: Partial<Record<EnvKey, string | undefined>> = {}): Record<EnvKey, string | undefined> {
  const tokenContract = hex(20);
  usedContracts.push(tokenContract);
  return {
    USDT_BSC_CHAIN_ID: "97",
    USDT_BSC_RPC_URL: "https://rpc.example.test",
    USDT_BSC_RECEIVING_ADDRESS: hex(20),
    USDT_BSC_TOKEN_CONTRACT: tokenContract,
    USDT_BSC_TOKEN_DECIMALS: "18",
    USDT_BSC_MAX_BLOCK_RANGE: undefined,
    USDT_BSC_INITIAL_LOOKBACK_BLOCKS: "50",
    USDT_WATCHER_TICK_INTERVAL_MS: "30",
    USDT_WATCHER_IDLE_INTERVAL_MS: "30",
    USDT_AUTO_CONFIRM_ENABLED: undefined,
    ...overrides,
  };
}

function stubProvider(overrides: Partial<EvmChainProvider> = {}) {
  return {
    getChainId: vi.fn(async () => 97),
    getTokenDecimals: vi.fn(async () => 18),
    getLatestBlockNumber: vi.fn(async () => 1000n),
    getFinalizedBlockNumber: vi.fn(async () => 1000n),
    getTransferLogs: vi.fn(async (): Promise<EvmTransferLog[]> => []),
    getBlockTimestampMs: vi.fn(async () => Date.now()),
    getReceipt: vi.fn(async (): Promise<EvmReceipt | null> => null),
    ...overrides,
  } satisfies EvmChainProvider;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000, pollMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(pollMs);
  }
  if (!(await predicate())) throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  const contracts = usedContracts.splice(0);
  await prisma.chainCredit.deleteMany({ where: { tokenContract: { in: contracts } } });
  await prisma.chainScanCursor.deleteMany({ where: { tokenContract: { in: contracts } } });
});

describe("resolveBscConfig", () => {
  const valid = {
    USDT_BSC_CHAIN_ID: "56",
    USDT_BSC_RPC_URL: "https://rpc.example.test/v1/KEY",
    USDT_BSC_RECEIVING_ADDRESS: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
    USDT_BSC_TOKEN_CONTRACT: "0x55d398326f99059fF775485246999027B3197955",
    USDT_BSC_TOKEN_DECIMALS: "18",
  };

  it("accepts a fully valid config, lowercases addresses and applies optional defaults", () => {
    const r = resolveBscConfig(valid);
    expect(r).toEqual({
      ok: true,
      config: {
        chainId: 56,
        rpcUrl: valid.USDT_BSC_RPC_URL,
        receivingAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        tokenContract: "0x55d398326f99059ff775485246999027b3197955",
        tokenDecimals: 18,
        maxBlockRange: 2000,
        initialLookbackBlocks: 2000,
      },
    });
  });

  it.each([
    ["USDT_BSC_CHAIN_ID", ""],
    ["USDT_BSC_CHAIN_ID", "1"],
    ["USDT_BSC_CHAIN_ID", "0x61"],
    ["USDT_BSC_CHAIN_ID", " 97"],
    ["USDT_BSC_RPC_URL", ""],
    ["USDT_BSC_RPC_URL", "http://rpc.example.test"],
    ["USDT_BSC_RPC_URL", "not a url"],
    ["USDT_BSC_RECEIVING_ADDRESS", "0x1234"],
    ["USDT_BSC_TOKEN_CONTRACT", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"],
    ["USDT_BSC_TOKEN_DECIMALS", ""],
    ["USDT_BSC_TOKEN_DECIMALS", "1"],
    ["USDT_BSC_TOKEN_DECIMALS", "37"],
    ["USDT_BSC_TOKEN_DECIMALS", "18.0"],
    ["USDT_BSC_MAX_BLOCK_RANGE", "0"],
    ["USDT_BSC_INITIAL_LOOKBACK_BLOCKS", "-5"],
  ])("is not configured when %s = %j", (key, value) => {
    expect(resolveBscConfig({ ...valid, [key]: value }).ok).toBe(false);
  });
});

describe("startBscWatcher — idle gate", () => {
  it("is idle (no provider call, no timer work) when USDT_BSC_* is unset", async () => {
    setEnv({ USDT_WATCHER_TICK_INTERVAL_MS: "20" });
    const provider = stubProvider();
    const watcher = await startBscWatcher(provider);
    await sleep(150);
    expect(provider.getChainId).not.toHaveBeenCalled();
    expect(provider.getLatestBlockNumber).not.toHaveBeenCalled();
    await watcher.stop();
  });

  it("is idle — never defaults to mainnet — when USDT_BSC_CHAIN_ID is invalid", async () => {
    setEnv(configuredEnv({ USDT_BSC_CHAIN_ID: "1" }));
    const provider = stubProvider();
    const watcher = await startBscWatcher(provider);
    await sleep(150);
    expect(provider.getChainId).not.toHaveBeenCalled();
    await watcher.stop();
  });

  it("builds its provider from USDT_BSC_RPC_URL when none is injected", async () => {
    setEnv(configuredEnv({ USDT_BSC_RPC_URL: "https://rpc.example.test/abc" }));
    const createBscProvider = vi.fn(() => stubProvider({ getChainId: vi.fn(async () => 1) }));
    vi.doMock("./providers/bsc", () => ({ createBscProvider }));
    vi.resetModules();
    try {
      const mod = await import("./bsc-runner");
      const watcher = await mod.startBscWatcher();
      expect(createBscProvider).toHaveBeenCalledWith({ rpcUrl: "https://rpc.example.test/abc" });
      await watcher.stop();
    } finally {
      vi.doUnmock("./providers/bsc");
      vi.resetModules();
    }
  });
});

describe("startBscWatcher — startup verification", () => {
  it("a chainId mismatch blocks every stage and keeps retrying", async () => {
    setEnv(configuredEnv({ USDT_BSC_CHAIN_ID: "97" }));
    const provider = stubProvider({ getChainId: vi.fn(async () => 56) });
    const watcher = await startBscWatcher(provider);
    await waitUntil(() => vi.mocked(provider.getChainId).mock.calls.length >= 2);
    await watcher.stop();
    expect(provider.getTokenDecimals).not.toHaveBeenCalled();
    expect(provider.getLatestBlockNumber).not.toHaveBeenCalled();
    expect(provider.getTransferLogs).not.toHaveBeenCalled();
  });

  it("a decimals mismatch blocks every stage and keeps retrying", async () => {
    setEnv(configuredEnv({ USDT_BSC_TOKEN_DECIMALS: "18" }));
    const provider = stubProvider({ getTokenDecimals: vi.fn(async () => 6) });
    const watcher = await startBscWatcher(provider);
    await waitUntil(() => vi.mocked(provider.getTokenDecimals).mock.calls.length >= 2);
    await watcher.stop();
    expect(provider.getLatestBlockNumber).not.toHaveBeenCalled();
  });

  it("once verified, runs ingest (and verifies only once)", async () => {
    setEnv(configuredEnv());
    const provider = stubProvider();
    const watcher = await startBscWatcher(provider);
    await waitUntil(() => vi.mocked(provider.getLatestBlockNumber).mock.calls.length >= 2);
    await watcher.stop();
    expect(provider.getChainId).toHaveBeenCalledTimes(1);
    expect(provider.getTransferLogs).toHaveBeenCalled();
  });
});

describe("startBscWatcher — end to end", () => {
  it("a stub BSC transfer of the exact 18-dp amount is ingested, finalized and credits an INR live account at ×100 paise", async () => {
    const env = configuredEnv({ USDT_AUTO_CONFIRM_ENABLED: "true" });
    setEnv(env);
    const tokenContract = env.USDT_BSC_TOKEN_CONTRACT!;
    const receivingAddress = env.USDT_BSC_RECEIVING_ADDRESS!;

    const user = await prisma.user.create({ data: { email: `bsc-e2e-${randomUUID()}@test.local`, passwordHash: "x" } });
    await createAccountsForUser(user.id, 0); // INR by default

    try {
      const deposit = await createUsdtDepositIntent({
        userId: user.id,
        amountUsdtMinorRequested: 56_000,
        network: "bsc",
        tokenContract,
        receivingAddress,
        correlationId: randomUUID(),
      });
      const usdtMinor = deposit.amountUsdtMinor!;
      const rawValue = BigInt(usdtMinor) * 10n ** 16n; // 2dp → 18dp, exact
      const txHash = hex(32);
      const blockNumber = 990n;

      const provider = stubProvider({
        getTransferLogs: vi.fn(async (p: { fromBlock: bigint; toBlock: bigint }) =>
          blockNumber >= p.fromBlock && blockNumber <= p.toBlock
            ? [{ txHash, logIndex: 3, blockNumber, fromAddress: hex(20), toAddress: receivingAddress, rawValue, removed: false }]
            : [],
        ),
        getReceipt: vi.fn(async (tx: string) =>
          tx === txHash
            ? {
                status: 1 as const,
                blockNumber,
                logs: [{ logIndex: 3, address: tokenContract, topics: [TRANSFER_TOPIC, pad(hex(20)), pad(receivingAddress)], data: word(rawValue) }],
              }
            : null,
        ),
      });

      const watcher = await startBscWatcher(provider);
      try {
        await waitUntil(async () => (await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } })).status === "COMPLETED");
      } finally {
        await watcher.stop();
      }

      const credit = await prisma.chainCredit.findFirstOrThrow({ where: { tokenContract, txHash } });
      expect(credit.network).toBe("bsc");
      expect(credit.tokenDecimals).toBe(18);
      expect(credit.rawAmount.toFixed(0)).toBe(rawValue.toString());
      expect(credit.finalityState).toBe("FINAL");
      expect(credit.processingStatus).toBe("MATCHED");

      const liveAccount = await prisma.account.findFirstOrThrow({ where: { userId: user.id, type: "LIVE" } });
      expect(liveAccount.currency).toBe("INR");
      const depositTx = await prisma.transaction.findFirstOrThrow({
        where: { accountId: liveAccount.id, refType: "Deposit", refId: deposit.id, kind: "DEPOSIT" },
      });
      expect(depositTx.amount).toBe(usdtMinor * 100);
    } finally {
      await prisma.transaction.deleteMany({ where: { account: { userId: user.id } } });
      await prisma.bonusGrant.deleteMany({ where: { account: { userId: user.id } } });
      await prisma.chainCredit.deleteMany({ where: { tokenContract } });
      await prisma.deposit.deleteMany({ where: { userId: user.id } });
      await prisma.account.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
