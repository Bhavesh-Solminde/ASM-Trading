import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This file tests the reconciliation runner's own scheduling/gating/logging
// behavior only — not the reconciliation checks themselves (that's
// packages/db's job, per the shared contract). @asm/db's runUsdtReconciliation
// is stubbed at the module boundary so these tests don't depend on the db
// package's checks or need a real database. @asm/logger is stubbed too,
// because `logger` is a lazily-constructed Proxy (see packages/logger/src
// /index.ts) whose `get` trap always reads from the real cached pino
// instance — `vi.spyOn(logger, "error")` would silently write onto the
// Proxy's own (unused) empty target and never actually intercept a call, so
// a full module mock is the only reliable way to observe what this runner
// logs.
const runUsdtReconciliation = vi.fn();
vi.mock("@asm/db", () => ({ runUsdtReconciliation }));

const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock("@asm/logger", () => ({ logger: loggerMock }));

const ENV_KEYS = [
  "USDT_NETWORK",
  "USDT_TRONGRID_NETWORK",
  "USDT_RECEIVING_ADDRESS",
  "USDT_TOKEN_CONTRACT",
  "USDT_BSC_CHAIN_ID",
  "USDT_BSC_RPC_URL",
  "USDT_BSC_RECEIVING_ADDRESS",
  "USDT_BSC_TOKEN_CONTRACT",
  "USDT_BSC_TOKEN_DECIMALS",
  "USDT_RECONCILIATION_INTERVAL_MS",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (vars[key] !== undefined) process.env[key] = vars[key];
    else delete process.env[key];
  }
}

function tronConfiguredEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  return {
    USDT_NETWORK: "tron",
    USDT_TRONGRID_NETWORK: "nile",
    USDT_RECEIVING_ADDRESS: `TReceiving-${randomUUID()}`,
    USDT_TOKEN_CONTRACT: `TContract-${randomUUID()}`,
    USDT_RECONCILIATION_INTERVAL_MS: "30",
    ...overrides,
  };
}

function bscConfiguredEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  return {
    USDT_BSC_CHAIN_ID: "97",
    USDT_BSC_RPC_URL: "https://rpc.example.test",
    USDT_BSC_RECEIVING_ADDRESS: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    USDT_BSC_TOKEN_CONTRACT: "0x55d398326f99059ff775485246999027b3197955",
    USDT_BSC_TOKEN_DECIMALS: "18",
    USDT_RECONCILIATION_INTERVAL_MS: "30",
    ...overrides,
  };
}

/** A fresh, configured import — module-level env reads mean we need a fresh module instance per configuration. */
async function importRunner() {
  vi.resetModules();
  return import("./reconciliation-runner");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000, pollMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(pollMs);
  }
  if (!(await predicate())) throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  runUsdtReconciliation.mockReset();
  runUsdtReconciliation.mockResolvedValue({ findings: [], opened: 0, stillOpen: 0, resolved: 0 });
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("startReconciliationRunner — idle gate", () => {
  it("is idle — never calls runUsdtReconciliation — when neither TRON nor BSC is configured", async () => {
    setEnv({});
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await sleep(150);

    expect(runUsdtReconciliation).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "chain.watcher.idle", network: "reconciliation" }),
      expect.any(String),
    );
    await runnerHandle.stop();
  });

  it("stays idle when TRON's own env is only partially set (mirrors runner.ts's idle branch)", async () => {
    setEnv({ USDT_NETWORK: "tron", USDT_RECEIVING_ADDRESS: "TReceiving-x" }); // no USDT_TRONGRID_NETWORK/USDT_TOKEN_CONTRACT
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await sleep(150);

    expect(runUsdtReconciliation).not.toHaveBeenCalled();
    await runnerHandle.stop();
  });

  it("stays idle when BSC's own env is invalid (mirrors resolveBscConfig's own validation)", async () => {
    setEnv(bscConfiguredEnv({ USDT_BSC_CHAIN_ID: "1" })); // not 56/97
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await sleep(150);

    expect(runUsdtReconciliation).not.toHaveBeenCalled();
    await runnerHandle.stop();
  });
});

describe("startReconciliationRunner — active once one network is configured", () => {
  it("runs ticks once TRON alone is fully configured", async () => {
    setEnv(tronConfiguredEnv());
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() => runUsdtReconciliation.mock.calls.length >= 1);
    await runnerHandle.stop();
  });

  it("runs ticks once BSC alone is fully configured", async () => {
    setEnv(bscConfiguredEnv());
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() => runUsdtReconciliation.mock.calls.length >= 1);
    await runnerHandle.stop();
  });

  it("does not run a second tick before the first one's promise settles — no overlap even if a tick is slow", async () => {
    setEnv(tronConfiguredEnv());
    // A `{ current }` box, not a plain `let` — reassigning a plain `let` from
    // inside this closure and reading it afterward defeats TS's narrowing of
    // its union type (the same reason runner.test.ts's own overlap test uses
    // this exact shape).
    const release: { current: (() => void) | null } = { current: null };
    runUsdtReconciliation.mockImplementation(
      () =>
        new Promise((resolve) => {
          release.current = () => resolve({ findings: [], opened: 0, stillOpen: 0, resolved: 0 });
        }),
    );
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() => runUsdtReconciliation.mock.calls.length >= 1);

    await sleep(150); // several intervals elapse while the first tick still hangs
    expect(runUsdtReconciliation).toHaveBeenCalledTimes(1);

    release.current?.();
    await waitUntil(() => runUsdtReconciliation.mock.calls.length >= 2);
    await runnerHandle.stop();
  });

  it("stop() prevents any further ticks", async () => {
    setEnv(tronConfiguredEnv());
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() => runUsdtReconciliation.mock.calls.length >= 1);
    await runnerHandle.stop();

    const countAtStop = runUsdtReconciliation.mock.calls.length;
    await sleep(150);
    expect(runUsdtReconciliation).toHaveBeenCalledTimes(countAtStop);
  });

  it("a failing tick never crashes the process — the loop keeps rescheduling", async () => {
    setEnv(tronConfiguredEnv());
    runUsdtReconciliation
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ findings: [], opened: 0, stillOpen: 0, resolved: 0 });
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() => runUsdtReconciliation.mock.calls.length >= 2);
    await runnerHandle.stop();
  });
});

describe("startReconciliationRunner — finding logging", () => {
  it("logs a P1 finding at error level with checkName/network/subjectType/subjectId/message", async () => {
    setEnv(tronConfiguredEnv());
    const finding = {
      checkName: "completed_deposit_broken_credit_link",
      severity: "P1" as const,
      network: "tron",
      subjectType: "Deposit" as const,
      subjectId: "deposit-123",
      message: "deposit.matchedChainCreditId is null",
    };
    runUsdtReconciliation.mockResolvedValue({ findings: [finding], opened: 1, stillOpen: 0, resolved: 0 });
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() => loggerMock.error.mock.calls.length >= 1);
    await runnerHandle.stop();

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "chain.reconciliation.finding",
        checkName: finding.checkName,
        network: finding.network,
        subjectType: finding.subjectType,
        subjectId: finding.subjectId,
        message: finding.message,
      }),
      expect.any(String),
    );
  });

  it("logs a WARNING finding at warn level, not error", async () => {
    setEnv(tronConfiguredEnv());
    const finding = {
      checkName: "stuck_unconfirmed_transfer",
      severity: "WARNING" as const,
      network: "tron",
      subjectType: "ChainCredit" as const,
      subjectId: "credit-456",
      message: "finalityState=DETECTED, stuck for 3h",
    };
    runUsdtReconciliation.mockResolvedValue({ findings: [finding], opened: 1, stillOpen: 0, resolved: 0 });
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() => loggerMock.warn.mock.calls.length >= 1);
    await runnerHandle.stop();

    expect(loggerMock.error).not.toHaveBeenCalledWith(expect.objectContaining({ evt: "chain.reconciliation.finding" }), expect.any(String));
  });

  it("logs a chain.reconciliation.run summary only when opened or resolved is non-zero", async () => {
    setEnv(tronConfiguredEnv());
    runUsdtReconciliation.mockResolvedValue({ findings: [], opened: 0, stillOpen: 2, resolved: 1 });
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() =>
      loggerMock.info.mock.calls.some((call) => (call[0] as { evt?: string })?.evt === "chain.reconciliation.run"),
    );
    await runnerHandle.stop();

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "chain.reconciliation.run", opened: 0, stillOpen: 2, resolved: 1 }),
      expect.any(String),
    );
  });

  it("stays silent (no summary line) on a completely clean run", async () => {
    setEnv(tronConfiguredEnv());
    runUsdtReconciliation.mockResolvedValue({ findings: [], opened: 0, stillOpen: 0, resolved: 0 });
    const { startReconciliationRunner } = await importRunner();

    const runnerHandle = startReconciliationRunner();
    await waitUntil(() => runUsdtReconciliation.mock.calls.length >= 2);
    await runnerHandle.stop();

    expect(loggerMock.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ evt: "chain.reconciliation.run" }),
      expect.any(String),
    );
  });
});
