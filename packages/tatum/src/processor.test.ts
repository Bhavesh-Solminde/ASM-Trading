import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allocateGatewayAddressIndex,
  createAccountsForUser,
  createGatewayUsdtDeposit,
  prisma,
  type Deposit,
} from "@asm/db";
import type { GatewayChain, VerifiedTx } from "./chain";
import { recheckDetectedCredits, recordAndSettleTransfer, scanGatewayDeposit } from "./processor";

// Test-only network id: never collides with real "tron"/"bsc" rows.
const NETWORK = `tron-proc-${randomUUID().slice(0, 8)}` as "tron";
const CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const SENDER = "TVF2Mp9QY7FEGTnr3DBpFLobA6jguHyMvi";

let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `tatum-proc-${randomUUID()}@test.local`, passwordHash: "x" } });
  userId = user.id;
  await createAccountsForUser(userId, 0, "USD");
});

afterAll(async () => {
  const deps = await prisma.deposit.findMany({ where: { userId }, select: { id: true, receivingAddress: true } });
  await prisma.chainCredit.deleteMany({ where: { network: NETWORK } });
  await prisma.auditLog.deleteMany({ where: { targetType: "Deposit", targetId: { in: deps.map((d) => d.id) } } });
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.gatewayAddressCounter.deleteMany({ where: { network: NETWORK } });
});

/** A scripted chain: each tx hash maps to whatever verifyTransfer should currently return. */
function fakeChain(): GatewayChain & { txs: Map<string, VerifiedTx>; incoming: Map<string, string[]>; verifyCalls: number } {
  const txs = new Map<string, VerifiedTx>();
  const incoming = new Map<string, string[]>();
  const chain = {
    network: NETWORK,
    tokenContract: CONTRACT,
    tokenDecimals: 6,
    txs,
    incoming,
    verifyCalls: 0,
    async deriveAddress() {
      throw new Error("unused");
    },
    async listIncomingTxHashes(address: string) {
      return incoming.get(address) ?? [];
    },
    async verifyTransfer(txHash: string) {
      chain.verifyCalls++;
      return txs.get(txHash) ?? { kind: "not_found" as const };
    },
  };
  return chain;
}

async function newDeposit(amountUsdtMinor: number): Promise<Deposit> {
  return createGatewayUsdtDeposit({
    userId,
    amountUsdtMinorRequested: amountUsdtMinor,
    network: NETWORK,
    tokenContract: CONTRACT,
    receivingAddress: `TProc-${randomUUID()}`,
    addressIndex: await allocateGatewayAddressIndex(NETWORK),
    correlationId: randomUUID(),
  });
}

const ok = (final: boolean, usdt: number): VerifiedTx => ({
  kind: "ok",
  final,
  blockNumber: 70_000_000n,
  blockTimestampMs: Date.now(),
  transfers: [{ eventIndex: 0, fromAddress: SENDER, rawValue: BigInt(usdt) * 10_000n }],
});

async function balance(): Promise<number> {
  return (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).realBalance;
}

describe("recordAndSettleTransfer", () => {
  it("records a not-yet-final transfer as DETECTED and credits nothing, then credits once final", async () => {
    const d = await newDeposit(2_500);
    const chain = fakeChain();
    const tx = randomUUID().replace(/-/g, "").padEnd(64, "0");
    const before = await balance();

    chain.txs.set(tx, ok(false, 2_500));
    const first = await recordAndSettleTransfer(chain, { txHash: tx, toAddress: d.receivingAddress! });
    expect(first).toEqual({ recorded: 1, settled: [] });
    const row = await prisma.chainCredit.findFirstOrThrow({ where: { network: NETWORK, txHash: tx } });
    expect(row).toMatchObject({ finalityState: "DETECTED", processingStatus: "PENDING", toAddress: d.receivingAddress, fromAddress: SENDER });
    expect(await balance()).toBe(before);

    chain.txs.set(tx, ok(true, 2_500));
    const second = await recordAndSettleTransfer(chain, { txHash: tx, toAddress: d.receivingAddress! });
    expect(second.recorded).toBe(0);
    expect(second.settled).toEqual([{ kind: "credited", depositId: d.id, creditedUsdtMinor: 2_500 }]);
    expect(await balance()).toBe(before + 2_500);

    // Idempotent: a third call (webhook retry / next poll) changes nothing.
    const third = await recordAndSettleTransfer(chain, { txHash: tx, toAddress: d.receivingAddress! });
    expect(third).toEqual({ recorded: 0, settled: [] });
    expect(await balance()).toBe(before + 2_500);
  });

  it("records nothing for a reverted or unknown tx", async () => {
    const d = await newDeposit(2_500);
    const chain = fakeChain();
    chain.txs.set("a".repeat(64), { kind: "failed" });
    expect(await recordAndSettleTransfer(chain, { txHash: "a".repeat(64), toAddress: d.receivingAddress! })).toEqual({
      recorded: 0,
      settled: [],
    });
    expect(await recordAndSettleTransfer(chain, { txHash: "b".repeat(64), toAddress: d.receivingAddress! })).toEqual({
      recorded: 0,
      settled: [],
    });
    expect(await prisma.chainCredit.count({ where: { network: NETWORK, toAddress: d.receivingAddress! } })).toBe(0);
  });
});

describe("scanGatewayDeposit + recheckDetectedCredits", () => {
  it("discovers a payment by polling, then finalizes and credits it on recheck", async () => {
    const d = await newDeposit(1_500);
    const chain = fakeChain();
    const tx = "c".repeat(63) + "1";
    chain.incoming.set(d.receivingAddress!, [tx]);
    chain.txs.set(tx, ok(false, 1_600));
    const before = await balance();

    await scanGatewayDeposit(chain, d);
    expect((await prisma.chainCredit.findFirstOrThrow({ where: { network: NETWORK, txHash: tx } })).finalityState).toBe("DETECTED");

    // A second scan must not re-verify a tx it already recorded (saves API credits);
    // recheck is what advances finality.
    const calls = chain.verifyCalls;
    await scanGatewayDeposit(chain, d);
    expect(chain.verifyCalls).toBe(calls);

    chain.txs.set(tx, ok(true, 1_600));
    await recheckDetectedCredits(new Map([[NETWORK, chain]]));
    expect(await balance()).toBe(before + 1_600);
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("COMPLETED");
  });
});
