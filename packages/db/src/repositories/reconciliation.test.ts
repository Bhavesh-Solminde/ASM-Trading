import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import {
  STUCK_TRANSFER_AGE_MS,
  countOpenReconciliationIssues,
  findReconciliationIssues,
  listOpenReconciliationIssues,
  listRecentlyResolvedReconciliationIssues,
  runUsdtReconciliation,
  type ReconciliationFinding,
} from "./reconciliation";
import type { ChainCreditFinalityState, ChainCreditProcessingStatus, Deposit, DepositStatus } from "../../generated/prisma/client";

const NETWORK = "tron";
const CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const RECEIVING_ADDRESS = "TReconcileReceiving11111111111111";

let userId = "";
const depositIds: string[] = [];
const creditIds: string[] = [];
const issueKeys: { checkName: string; subjectType: string; subjectId: string }[] = [];

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `reconciliation-test-${Date.now()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.reconciliationIssue.deleteMany({
    where: { OR: issueKeys.map((k) => ({ checkName: k.checkName, subjectType: k.subjectType, subjectId: k.subjectId })) },
  });
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { id: { in: depositIds } } });
  await prisma.chainCredit.deleteMany({ where: { id: { in: creditIds } } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

function trackIssue(f: Pick<ReconciliationFinding, "checkName" | "subjectType" | "subjectId">): void {
  issueKeys.push(f);
}

async function makeDeposit(
  overrides: Partial<{
    network: string;
    tokenContract: string;
    receivingAddress: string;
    amountUsdtMinor: number;
    matchedChainCreditId: string | null;
    status: DepositStatus;
  }> = {},
): Promise<Deposit> {
  const amountUsdtMinor = overrides.amountUsdtMinor ?? 1000;
  const deposit = await prisma.deposit.create({
    data: {
      userId,
      method: "USDT",
      amountUsd: 0,
      amountInr: -amountUsdtMinor,
      vpa: overrides.receivingAddress ?? RECEIVING_ADDRESS,
      checkoutToken: randomBytes(24).toString("base64url"),
      status: overrides.status ?? "COMPLETED",
      correlationId: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
      network: overrides.network ?? NETWORK,
      tokenContract: overrides.tokenContract ?? CONTRACT,
      receivingAddress: overrides.receivingAddress ?? RECEIVING_ADDRESS,
      amountUsdtMinor,
      matchedChainCreditId: overrides.matchedChainCreditId ?? null,
    },
  });
  depositIds.push(deposit.id);
  return deposit;
}

async function makeChainCredit(
  overrides: Partial<{
    network: string;
    tokenContract: string;
    toAddress: string;
    normalizedAmountMinor: number | null;
    consumed: boolean;
    processingStatus: ChainCreditProcessingStatus;
    finalityState: ChainCreditFinalityState;
    blockTimestamp: Date;
    txHash: string;
    eventIndex: number;
  }> = {},
) {
  const normalizedAmountMinor = overrides.normalizedAmountMinor === undefined ? 1000 : overrides.normalizedAmountMinor;
  const credit = await prisma.chainCredit.create({
    data: {
      network: overrides.network ?? NETWORK,
      tokenContract: overrides.tokenContract ?? CONTRACT,
      txHash: overrides.txHash ?? `tx-${randomUUID()}`,
      eventIndex: overrides.eventIndex ?? 0,
      fromAddress: "TReconcileSender1111111111111111",
      toAddress: overrides.toAddress ?? RECEIVING_ADDRESS,
      rawAmount: (BigInt(normalizedAmountMinor ?? 1000) * 10_000n).toString(),
      normalizedAmountMinor,
      blockNumber: 1_000_000n,
      blockTimestamp: overrides.blockTimestamp ?? new Date(),
      finalityState: overrides.finalityState ?? "FINAL",
      processingStatus: overrides.processingStatus ?? "MATCHED",
      consumed: overrides.consumed ?? true,
      rawPayload: {},
    },
  });
  creditIds.push(credit.id);
  return credit;
}

function findingFor(findings: ReconciliationFinding[], checkName: string, subjectId: string): ReconciliationFinding | undefined {
  return findings.find((f) => f.checkName === checkName && f.subjectId === subjectId);
}

describe("findReconciliationIssues", () => {
  it("a healthy COMPLETED deposit + matched credit raises nothing", async () => {
    const credit = await makeChainCredit({ normalizedAmountMinor: 2000 });
    const deposit = await makeDeposit({ amountUsdtMinor: 2000, matchedChainCreditId: credit.id });
    await prisma.transaction.create({
      data: { accountId: (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).id, kind: "DEPOSIT", amount: 2000, balanceAfter: 2000, refType: "Deposit", refId: deposit.id },
    });

    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "completed_deposit_broken_credit_link", deposit.id)).toBeUndefined();
    expect(findingFor(findings, "completed_usdt_amount_mismatch", deposit.id)).toBeUndefined();
    expect(findingFor(findings, "completed_usdt_network_mismatch", deposit.id)).toBeUndefined();
    expect(findingFor(findings, "completed_usdt_transaction_count", deposit.id)).toBeUndefined();
  });

  it("#1 completed_deposit_broken_credit_link — null matchedChainCreditId", async () => {
    const deposit = await makeDeposit({ matchedChainCreditId: null });
    const findings = await findReconciliationIssues();
    const f = findingFor(findings, "completed_deposit_broken_credit_link", deposit.id);
    expect(f).toBeDefined();
    expect(f?.severity).toBe("P1");
  });

  it("#1 completed_deposit_broken_credit_link — matchedChainCreditId points nowhere", async () => {
    const deposit = await makeDeposit({ matchedChainCreditId: randomUUID() });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "completed_deposit_broken_credit_link", deposit.id)).toBeDefined();
  });

  it("#1 completed_deposit_broken_credit_link — credit exists but isn't consumed+MATCHED", async () => {
    const credit = await makeChainCredit({ consumed: false, processingStatus: "PENDING" });
    const deposit = await makeDeposit({ matchedChainCreditId: credit.id });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "completed_deposit_broken_credit_link", deposit.id)).toBeDefined();
  });

  it("#2 matched_credit_broken_deposit_link — no deposit references the credit", async () => {
    const credit = await makeChainCredit({ consumed: true, processingStatus: "MATCHED" });
    const findings = await findReconciliationIssues();
    const f = findingFor(findings, "matched_credit_broken_deposit_link", credit.id);
    expect(f).toBeDefined();
    expect(f?.severity).toBe("P1");
  });

  it("#2 matched_credit_broken_deposit_link — the referencing deposit isn't COMPLETED", async () => {
    const credit = await makeChainCredit({ consumed: true, processingStatus: "MATCHED" });
    await makeDeposit({ matchedChainCreditId: credit.id, status: "REJECTED" });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "matched_credit_broken_deposit_link", credit.id)).toBeDefined();
  });

  it("#3 completed_usdt_amount_mismatch", async () => {
    const credit = await makeChainCredit({ normalizedAmountMinor: 5000 });
    const deposit = await makeDeposit({ amountUsdtMinor: 4999, matchedChainCreditId: credit.id });
    const findings = await findReconciliationIssues();
    const f = findingFor(findings, "completed_usdt_amount_mismatch", deposit.id);
    expect(f).toBeDefined();
    expect(f?.message).toContain("4999");
    expect(f?.message).toContain("5000");
  });

  it("#4 completed_usdt_network_mismatch", async () => {
    const credit = await makeChainCredit({ toAddress: "TDifferentAddress111111111111111" });
    const deposit = await makeDeposit({ matchedChainCreditId: credit.id, receivingAddress: RECEIVING_ADDRESS });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "completed_usdt_network_mismatch", deposit.id)).toBeDefined();
  });

  it("#5 completed_usdt_transaction_count — zero transactions", async () => {
    const credit = await makeChainCredit({ normalizedAmountMinor: 3000 });
    const deposit = await makeDeposit({ amountUsdtMinor: 3000, matchedChainCreditId: credit.id });
    const findings = await findReconciliationIssues();
    const f = findingFor(findings, "completed_usdt_transaction_count", deposit.id);
    expect(f).toBeDefined();
    expect(f?.message).toContain("0 DEPOSIT transactions");
  });

  it("#5 completed_usdt_transaction_count — two transactions", async () => {
    const credit = await makeChainCredit({ normalizedAmountMinor: 3500 });
    const deposit = await makeDeposit({ amountUsdtMinor: 3500, matchedChainCreditId: credit.id });
    const accountId = (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).id;
    await prisma.transaction.createMany({
      data: [
        { accountId, kind: "DEPOSIT", amount: 3500, balanceAfter: 3500, refType: "Deposit", refId: deposit.id },
        { accountId, kind: "DEPOSIT", amount: 3500, balanceAfter: 7000, refType: "Deposit", refId: deposit.id },
      ],
    });
    const findings = await findReconciliationIssues();
    const f = findingFor(findings, "completed_usdt_transaction_count", deposit.id);
    expect(f).toBeDefined();
    expect(f?.message).toContain("2 DEPOSIT transactions");
  });

  it("a reversed (REJECTED) deposit's leftover DEPOSIT transactions are NOT flagged — only COMPLETED deposits are checked", async () => {
    const deposit = await makeDeposit({ status: "REJECTED", matchedChainCreditId: null });
    const accountId = (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).id;
    await prisma.transaction.createMany({
      data: [
        { accountId, kind: "DEPOSIT", amount: 1000, balanceAfter: 1000, refType: "Deposit", refId: deposit.id },
        { accountId, kind: "DEPOSIT", amount: -1000, balanceAfter: 0, refType: "Deposit", refId: deposit.id },
      ],
    });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "completed_usdt_transaction_count", deposit.id)).toBeUndefined();
    expect(findingFor(findings, "completed_deposit_broken_credit_link", deposit.id)).toBeUndefined();
  });

  it("a lapsed AWAITING_PAYMENT deposit raises nothing", async () => {
    const deposit = await makeDeposit({ status: "AWAITING_PAYMENT", matchedChainCreditId: null });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "completed_deposit_broken_credit_link", deposit.id)).toBeUndefined();
  });

  it("#6 duplicate_chain_credit_identity", async () => {
    const sharedTxHash = `tx-${randomUUID()}`;
    // Only reachable by writing around the DB's own unique constraint at a
    // different eventIndex-independent layer is impossible from the client —
    // simulate the "should be impossible" case by inserting via two eventIndex
    // values is NOT a duplicate. Instead assert the check is wired: a single
    // row never fires it, and the groupBy query runs without throwing when
    // there are zero duplicates in the whole (shared) dev database.
    const credit = await makeChainCredit({ txHash: sharedTxHash, eventIndex: 0 });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "duplicate_chain_credit_identity", credit.id)).toBeUndefined();
  });

  it("#7 duplicate_matched_chain_credit — a single deposit is never flagged", async () => {
    const credit = await makeChainCredit({ consumed: true, processingStatus: "MATCHED" });
    const deposit = await makeDeposit({ matchedChainCreditId: credit.id });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "duplicate_matched_chain_credit", deposit.id)).toBeUndefined();
  });

  it("#8 stuck_unconfirmed_transfer (WARNING) — old DETECTED/CONFIRMING rows are flagged, recent ones aren't", async () => {
    const old = await makeChainCredit({
      finalityState: "DETECTED",
      blockTimestamp: new Date(Date.now() - STUCK_TRANSFER_AGE_MS - 60_000),
    });
    const recent = await makeChainCredit({
      finalityState: "CONFIRMING",
      blockTimestamp: new Date(Date.now() - 60_000),
    });
    const findings = await findReconciliationIssues();
    const oldFinding = findingFor(findings, "stuck_unconfirmed_transfer", old.id);
    expect(oldFinding).toBeDefined();
    expect(oldFinding?.severity).toBe("WARNING");
    expect(findingFor(findings, "stuck_unconfirmed_transfer", recent.id)).toBeUndefined();
  });

  it("a FINAL credit is never flagged as stuck, however old", async () => {
    const credit = await makeChainCredit({
      finalityState: "FINAL",
      blockTimestamp: new Date(Date.now() - STUCK_TRANSFER_AGE_MS - 60_000),
    });
    const findings = await findReconciliationIssues();
    expect(findingFor(findings, "stuck_unconfirmed_transfer", credit.id)).toBeUndefined();
  });
});

describe("runUsdtReconciliation — open/resolved lifecycle", () => {
  it("opens an issue, keeps it open on a second run, then resolves it once fixed", async () => {
    const deposit = await makeDeposit({ matchedChainCreditId: null });
    trackIssue({ checkName: "completed_deposit_broken_credit_link", subjectType: "Deposit", subjectId: deposit.id });

    const first = await runUsdtReconciliation();
    expect(findingFor(first.findings, "completed_deposit_broken_credit_link", deposit.id)).toBeDefined();
    expect(first.opened).toBeGreaterThanOrEqual(1);

    const stored1 = await prisma.reconciliationIssue.findUniqueOrThrow({
      where: { checkName_subjectType_subjectId: { checkName: "completed_deposit_broken_credit_link", subjectType: "Deposit", subjectId: deposit.id } },
    });
    expect(stored1.status).toBe("OPEN");
    expect(stored1.severity).toBe("P1");
    const firstDetectedAt = stored1.firstDetectedAt;

    const second = await runUsdtReconciliation();
    expect(second.stillOpen).toBeGreaterThanOrEqual(1);
    const stored2 = await prisma.reconciliationIssue.findUniqueOrThrow({
      where: { checkName_subjectType_subjectId: { checkName: "completed_deposit_broken_credit_link", subjectType: "Deposit", subjectId: deposit.id } },
    });
    expect(stored2.status).toBe("OPEN");
    // firstDetectedAt must never move on a re-run of an already-open issue.
    expect(stored2.firstDetectedAt.getTime()).toBe(firstDetectedAt.getTime());

    // Fix it: attach a valid matched credit.
    const credit = await makeChainCredit({ normalizedAmountMinor: 1000 });
    await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
    await prisma.deposit.update({ where: { id: deposit.id }, data: { matchedChainCreditId: credit.id } });

    const third = await runUsdtReconciliation();
    expect(findingFor(third.findings, "completed_deposit_broken_credit_link", deposit.id)).toBeUndefined();
    expect(third.resolved).toBeGreaterThanOrEqual(1);

    const stored3 = await prisma.reconciliationIssue.findUniqueOrThrow({
      where: { checkName_subjectType_subjectId: { checkName: "completed_deposit_broken_credit_link", subjectType: "Deposit", subjectId: deposit.id } },
    });
    expect(stored3.status).toBe("RESOLVED");
    expect(stored3.resolvedAt).not.toBeNull();
  });
});

describe("countOpenReconciliationIssues / listOpenReconciliationIssues / listRecentlyResolvedReconciliationIssues", () => {
  it("counts and lists reflect a freshly-opened issue, then move it to resolved", async () => {
    const deposit = await makeDeposit({ matchedChainCreditId: randomUUID() });
    trackIssue({ checkName: "completed_deposit_broken_credit_link", subjectType: "Deposit", subjectId: deposit.id });

    await runUsdtReconciliation();
    const countsAfterOpen = await countOpenReconciliationIssues();
    expect(countsAfterOpen.p1).toBeGreaterThanOrEqual(1);

    const open = await listOpenReconciliationIssues(500);
    expect(open.some((i) => i.subjectId === deposit.id && i.checkName === "completed_deposit_broken_credit_link")).toBe(true);

    const credit = await makeChainCredit({ normalizedAmountMinor: 1000 });
    await prisma.deposit.update({ where: { id: deposit.id }, data: { matchedChainCreditId: credit.id } });
    await runUsdtReconciliation();

    const resolved = await listRecentlyResolvedReconciliationIssues(200);
    expect(resolved.some((i) => i.subjectId === deposit.id && i.checkName === "completed_deposit_broken_credit_link")).toBe(true);
  });
});
