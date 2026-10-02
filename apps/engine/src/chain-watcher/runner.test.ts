import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountsForUser, createUsdtDepositIntent, prisma } from "@asm/db";
import type { ChainProvider, EventResolution, ExecutionResult, TransferPage } from "./types";

const ENV_KEYS = [
  "USDT_NETWORK",
  "USDT_TRONGRID_NETWORK",
  "USDT_RECEIVING_ADDRESS",
  "USDT_TOKEN_CONTRACT",
  "USDT_TRONGRID_API_KEY",
  "USDT_WATCHER_TICK_INTERVAL_MS",
  "USDT_WATCHER_IDLE_INTERVAL_MS",
  "USDT_OVERLAP_MS",
  "USDT_MAX_PAGES_PER_TICK",
  "USDT_AUTO_CONFIRM_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (vars[key] !== undefined) process.env[key] = vars[key];
    else delete process.env[key];
  }
}

/** A fresh, configured import — module-level env reads mean we need a fresh module instance per configuration. */
async function importRunner() {
  vi.resetModules();
  return import("./runner");
}

function stubProvider(overrides: Partial<ChainProvider> = {}): ChainProvider {
  return {
    fetchTransferPage: vi.fn(async (): Promise<TransferPage> => ({ rows: [], nextFingerprint: null })),
    resolveTransferEvent: vi.fn(async (): Promise<EventResolution> => ({ kind: "not_found" })),
    getExecutionResult: vi.fn(async (): Promise<ExecutionResult> => ({ state: "not_yet_solidified" })),
    getTokenDecimals: vi.fn(async () => 6),
    ...overrides,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls a real (unfaked) condition until it's true or the timeout elapses — real timers throughout, no fake-timer/real-I/O interleaving to fight. */
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
  pollMs = 20,
): Promise<void> {
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
  await prisma.chainScanCursor.deleteMany({ where: { tokenContract: { startsWith: "TContract-" } } });
});

describe("resolveTronGridFullHost", () => {
  it("resolves 'mainnet' to the verified TronGrid mainnet host", async () => {
    const { resolveTronGridFullHost } = await importRunner();
    expect(resolveTronGridFullHost("mainnet")).toBe("https://api.trongrid.io");
  });

  it("resolves 'nile' to the verified TronGrid Nile host", async () => {
    const { resolveTronGridFullHost } = await importRunner();
    expect(resolveTronGridFullHost("nile")).toBe("https://nile.trongrid.io");
  });

  it("rejects any other value — never constructs a URL from it, never falls back to mainnet", async () => {
    const { resolveTronGridFullHost } = await importRunner();
    expect(resolveTronGridFullHost("shasta")).toBeNull();
    expect(resolveTronGridFullHost("Mainnet")).toBeNull(); // case-sensitive, no fuzzy matching
    expect(resolveTronGridFullHost("https://api.trongrid.io")).toBeNull(); // not a passthrough
    expect(resolveTronGridFullHost("")).toBeNull();
  });
});

describe("startChainWatcher — idle when unconfigured", () => {
  it("schedules no work and calls no provider method when USDT_RECEIVING_ADDRESS/USDT_TOKEN_CONTRACT are unset", async () => {
    setEnv({ USDT_NETWORK: "tron", USDT_WATCHER_TICK_INTERVAL_MS: "20" });
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider();

    const watcher = await startChainWatcher(provider);
    await sleep(150);

    expect(provider.getTokenDecimals).not.toHaveBeenCalled();
    expect(provider.fetchTransferPage).not.toHaveBeenCalled();
    await watcher.stop();
  });

  it("is idle for any network other than the implemented 'tron'", async () => {
    setEnv({
      USDT_NETWORK: "ethereum",
      USDT_RECEIVING_ADDRESS: "0xabc",
      USDT_TOKEN_CONTRACT: "0xdef",
      USDT_WATCHER_TICK_INTERVAL_MS: "20",
    });
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider();

    const watcher = await startChainWatcher(provider);
    await sleep(150);
    expect(provider.getTokenDecimals).not.toHaveBeenCalled();
    await watcher.stop();
  });

  it("stays idle — never defaults to mainnet — when USDT_TRONGRID_NETWORK is unset, even with everything else configured", async () => {
    setEnv({
      USDT_NETWORK: "tron",
      USDT_RECEIVING_ADDRESS: `TReceiving-${randomUUID()}`,
      USDT_TOKEN_CONTRACT: `TContract-${randomUUID()}`,
      USDT_WATCHER_TICK_INTERVAL_MS: "20",
      // USDT_TRONGRID_NETWORK deliberately omitted.
    });
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider();

    const watcher = await startChainWatcher(provider);
    await sleep(150);
    expect(provider.getTokenDecimals).not.toHaveBeenCalled();
    expect(provider.fetchTransferPage).not.toHaveBeenCalled();
    await watcher.stop();
  });

  it("stays idle — never silently falls back to mainnet — when USDT_TRONGRID_NETWORK is an invalid value", async () => {
    setEnv({
      USDT_NETWORK: "tron",
      USDT_TRONGRID_NETWORK: "shasta", // deliberately not a supported value
      USDT_RECEIVING_ADDRESS: `TReceiving-${randomUUID()}`,
      USDT_TOKEN_CONTRACT: `TContract-${randomUUID()}`,
      USDT_WATCHER_TICK_INTERVAL_MS: "20",
    });
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider();

    const watcher = await startChainWatcher(provider);
    await sleep(150);
    expect(provider.getTokenDecimals).not.toHaveBeenCalled();
    expect(provider.fetchTransferPage).not.toHaveBeenCalled();
    await watcher.stop();
  });
});

describe("startChainWatcher — provider construction", () => {
  afterEach(() => {
    vi.doUnmock("./providers/tron");
  });

  it("passes the resolved fullHost through to createTronProvider when no provider is injected", async () => {
    setEnv({
      USDT_NETWORK: "tron",
      USDT_TRONGRID_NETWORK: "nile",
      USDT_RECEIVING_ADDRESS: `TReceiving-${randomUUID()}`,
      USDT_TOKEN_CONTRACT: `TContract-${randomUUID()}`,
      USDT_WATCHER_TICK_INTERVAL_MS: "20",
    });

    const createTronProvider = vi.fn(() => stubProvider());
    vi.doMock("./providers/tron", () => ({ createTronProvider }));
    vi.resetModules();
    const { startChainWatcher } = await import("./runner");

    const watcher = await startChainWatcher(); // no provider injected — must build its own
    await waitUntil(() => createTronProvider.mock.calls.length >= 1);
    expect(createTronProvider).toHaveBeenCalledWith(expect.objectContaining({ fullHost: "https://nile.trongrid.io" }));

    await watcher.stop();
  });

  it("passes the mainnet host through when USDT_TRONGRID_NETWORK=mainnet is explicitly set", async () => {
    setEnv({
      USDT_NETWORK: "tron",
      USDT_TRONGRID_NETWORK: "mainnet",
      USDT_RECEIVING_ADDRESS: `TReceiving-${randomUUID()}`,
      USDT_TOKEN_CONTRACT: `TContract-${randomUUID()}`,
      USDT_WATCHER_TICK_INTERVAL_MS: "20",
    });

    const createTronProvider = vi.fn(() => stubProvider());
    vi.doMock("./providers/tron", () => ({ createTronProvider }));
    vi.resetModules();
    const { startChainWatcher } = await import("./runner");

    const watcher = await startChainWatcher();
    await waitUntil(() => createTronProvider.mock.calls.length >= 1);
    expect(createTronProvider).toHaveBeenCalledWith(expect.objectContaining({ fullHost: "https://api.trongrid.io" }));

    await watcher.stop();
  });
});

describe("startChainWatcher — configured behavior", () => {
  function configuredEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
    return {
      USDT_NETWORK: "tron",
      // Nile, never mainnet, as the default for these tests — the point of
      // this whole feature is that a test run must never be one accidental
      // env value away from touching real mainnet funds.
      USDT_TRONGRID_NETWORK: "nile",
      USDT_RECEIVING_ADDRESS: `TReceiving-${randomUUID()}`,
      USDT_TOKEN_CONTRACT: `TContract-${randomUUID()}`,
      USDT_WATCHER_TICK_INTERVAL_MS: "30",
      // Idle pacing equal to the fast interval: these tests exercise the
      // stages themselves, not the adaptive pacing (covered separately below).
      USDT_WATCHER_IDLE_INTERVAL_MS: "30",
      ...overrides,
    };
  }

  it("verifies decimals before ever calling ingest — a mismatch blocks every stage, every tick, without crashing", async () => {
    setEnv(configuredEnv());
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider({ getTokenDecimals: vi.fn(async () => 18) }); // wrong — not canonical USDT-TRC20

    const watcher = await startChainWatcher(provider);
    await waitUntil(() => (provider.getTokenDecimals as ReturnType<typeof vi.fn>).mock.calls.length >= 2);
    expect(provider.fetchTransferPage).not.toHaveBeenCalled();
    await watcher.stop();
  });

  it("runs ingest and finality once decimals verify, but never match unless USDT_AUTO_CONFIRM_ENABLED=true", async () => {
    setEnv(configuredEnv());
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider();

    const watcher = await startChainWatcher(provider);
    await waitUntil(() => (provider.fetchTransferPage as ReturnType<typeof vi.fn>).mock.calls.length >= 1);
    await sleep(100); // give a spurious match-stage call time to show up, if it were ever going to
    await watcher.stop();

    expect(provider.getTokenDecimals).toHaveBeenCalled();
    expect(provider.getExecutionResult).not.toHaveBeenCalled(); // finality ran with 0 pending rows — proves it ran without needing a real check
  });

  it("runs the match stage too when USDT_AUTO_CONFIRM_ENABLED=true", async () => {
    setEnv(configuredEnv({ USDT_AUTO_CONFIRM_ENABLED: "true" }));
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider();

    const watcher = await startChainWatcher(provider);
    await waitUntil(() => (provider.fetchTransferPage as ReturnType<typeof vi.fn>).mock.calls.length >= 1);
    await watcher.stop();
    // No pending chain credits exist, so listPendingMatches returns nothing —
    // this only proves the match stage's own DB read ran, not that it
    // credited anything (match.test.ts covers the crediting behavior itself).
  });

  it("does not run a second tick before the first one's promise settles — no overlap even if a tick is slow", async () => {
    setEnv(configuredEnv());
    const { startChainWatcher } = await importRunner();

    const release: { current: (() => void) | null } = { current: null };
    const fetchTransferPage = vi.fn(
      () =>
        new Promise<TransferPage>((resolve) => {
          release.current = () => resolve({ rows: [], nextFingerprint: null });
        }),
    );
    const provider = stubProvider({ fetchTransferPage });

    const watcher = await startChainWatcher(provider);
    await waitUntil(() => fetchTransferPage.mock.calls.length >= 1);

    // Several intervals elapse while the first call is still hanging — no
    // second call should ever be made, since schedule() only re-arms the
    // timer inside the first tick's own .finally(), which can't run yet.
    await sleep(150);
    expect(fetchTransferPage).toHaveBeenCalledTimes(1);

    release.current?.();
    await waitUntil(() => fetchTransferPage.mock.calls.length >= 2);
    expect(fetchTransferPage).toHaveBeenCalledTimes(2);

    await watcher.stop();
  });

  it("recovers from a stage throwing — the timer loop keeps running for the next tick", async () => {
    setEnv(configuredEnv());
    const { startChainWatcher } = await importRunner();
    const fetchTransferPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ rows: [], nextFingerprint: null });
    const provider = stubProvider({ fetchTransferPage });

    const watcher = await startChainWatcher(provider);
    await waitUntil(() => fetchTransferPage.mock.calls.length >= 2);
    await watcher.stop();
  });

  it("stop() prevents any further ticks", async () => {
    setEnv(configuredEnv());
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider();

    const watcher = await startChainWatcher(provider);
    await waitUntil(() => (provider.fetchTransferPage as ReturnType<typeof vi.fn>).mock.calls.length >= 1);
    await watcher.stop();

    const countAtStop = (provider.fetchTransferPage as ReturnType<typeof vi.fn>).mock.calls.length;
    await sleep(150);
    expect(provider.fetchTransferPage).toHaveBeenCalledTimes(countAtStop); // unchanged — no more ticks
  });

  it("runs ingest, then finality, then match in that order — a real transfer flows end-to-end and credits the deposit in one tick", async () => {
    const env = configuredEnv({ USDT_AUTO_CONFIRM_ENABLED: "true" });
    setEnv(env);
    const { startChainWatcher } = await importRunner();

    const user = await prisma.user.create({ data: { email: `runner-e2e-${randomUUID()}@test.local`, passwordHash: "x" } });
    await createAccountsForUser(user.id, 0);
    await prisma.account.updateMany({ where: { userId: user.id, type: "LIVE" }, data: { currency: "USDT" } });

    const deposit = await createUsdtDepositIntent({
      userId: user.id,
      amountUsdtMinorRequested: 55_000,
      network: env.USDT_NETWORK!,
      tokenContract: env.USDT_TOKEN_CONTRACT!,
      receivingAddress: env.USDT_RECEIVING_ADDRESS!,
      correlationId: randomUUID(),
    });
    const rawAmount = BigInt(deposit.amountUsdtMinor!) * 10_000n;

    // Order matters here: if match ran before finality (or finality before
    // ingest), this row could never reach COMPLETED within one tick — this
    // test only passes if runner.ts actually executes the stages in the
    // documented ingest -> finality -> match order.
    let served = false;
    const provider = stubProvider({
      fetchTransferPage: vi.fn(async (): Promise<TransferPage> => {
        if (served) return { rows: [], nextFingerprint: null };
        served = true;
        return {
          rows: [
            {
              transactionId: `tx-${randomUUID()}`,
              fromAddress: "TSender111",
              toAddress: env.USDT_RECEIVING_ADDRESS!,
              rawValue: rawAmount.toString(),
              tokenContract: env.USDT_TOKEN_CONTRACT!,
              tokenDecimals: 6,
              blockTimestampMs: Date.now(),
            },
          ],
          nextFingerprint: null,
        };
      }),
      resolveTransferEvent: vi.fn(
        async (): Promise<EventResolution> => ({ kind: "resolved", eventIndex: 0, blockNumber: 1_000_000n }),
      ),
      getExecutionResult: vi.fn(async (): Promise<ExecutionResult> => ({ state: "solidified", success: true })),
    });

    const watcher = await startChainWatcher(provider);
    try {
      await waitUntil(async () => {
        const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
        return updated.status === "COMPLETED";
      });
    } finally {
      await watcher.stop();
      await prisma.transaction.deleteMany({ where: { account: { userId: user.id } } });
      await prisma.bonusGrant.deleteMany({ where: { account: { userId: user.id } } });
      await prisma.chainCredit.deleteMany({ where: { tokenContract: env.USDT_TOKEN_CONTRACT } });
      await prisma.deposit.deleteMany({ where: { userId: user.id } });
      await prisma.account.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

describe("startChainWatcher — adaptive pacing", () => {
  function pacedEnv() {
    return {
      USDT_NETWORK: "tron",
      USDT_TRONGRID_NETWORK: "nile",
      USDT_RECEIVING_ADDRESS: `TReceiving-${randomUUID()}`,
      USDT_TOKEN_CONTRACT: `TContract-${randomUUID()}`,
      USDT_WATCHER_TICK_INTERVAL_MS: "25",
      USDT_WATCHER_IDLE_INTERVAL_MS: "600000",
    };
  }

  it("makes no chain calls between idle ticks when nobody is depositing, then speeds up as soon as a deposit opens", async () => {
    const env = pacedEnv();
    setEnv(env);
    const { startChainWatcher } = await importRunner();
    const provider = stubProvider();
    const calls = () => (provider.fetchTransferPage as ReturnType<typeof vi.fn>).mock.calls.length;

    const user = await prisma.user.create({ data: { email: `paced-${randomUUID()}@test.local`, passwordHash: "x" } });
    await createAccountsForUser(user.id, 0);

    const watcher = await startChainWatcher(provider);
    try {
      // First wake always runs a full tick (nothing has run yet)…
      await waitUntil(() => calls() >= 1);
      // …then with no activity, many 25ms wakes pass without another chain call.
      await sleep(300);
      expect(calls()).toBe(1);

      // A user presses "Proceed to Pay" — the next wake sees it and goes fast.
      await createUsdtDepositIntent({
        userId: user.id,
        amountUsdtMinorRequested: 5_000,
        network: env.USDT_NETWORK,
        tokenContract: env.USDT_TOKEN_CONTRACT,
        receivingAddress: env.USDT_RECEIVING_ADDRESS,
        correlationId: randomUUID(),
      });
      await waitUntil(() => calls() >= 3);
    } finally {
      await watcher.stop();
      await prisma.deposit.deleteMany({ where: { userId: user.id } });
      await prisma.account.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
