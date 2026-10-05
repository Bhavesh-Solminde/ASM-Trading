import { prisma } from "../client";
import type { DepositStatus, GatewaySweep, GatewaySweepStatus } from "../../generated/prisma/client";
import { GATEWAY_TATUM } from "./gateway-deposit";

/**
 * Persistence for the offline Tatum USDT sweep tool
 * (packages/tatum/scripts/sweep.ts). Audit only: what to sweep is always
 * decided from the live on-chain balance, never from these rows. See
 * docs/superpowers/specs/2026-10-05-tatum-usdt-sweep-design.md.
 */

export interface GatewaySweepCandidate {
  depositId: string;
  status: DepositStatus;
  receivingAddress: string;
  addressIndex: number;
  tokenContract: string | null;
}

/**
 * Gateway deposit addresses that may hold USDT to sweep, oldest index first.
 * COMPLETED by default; `includeUnresolved` adds EXPIRED/REJECTED (late,
 * underpaid or otherwise unmatched payments). Live deposits are never
 * returned — their address may still be receiving the payment.
 */
export async function listGatewaySweepCandidates(input: {
  network: string;
  includeUnresolved: boolean;
}): Promise<GatewaySweepCandidate[]> {
  const statuses: DepositStatus[] = input.includeUnresolved ? ["COMPLETED", "EXPIRED", "REJECTED"] : ["COMPLETED"];
  const rows = await prisma.deposit.findMany({
    where: {
      gateway: GATEWAY_TATUM,
      network: input.network,
      status: { in: statuses },
      receivingAddress: { not: null },
      gatewayAddressIndex: { not: null },
    },
    orderBy: { gatewayAddressIndex: "asc" },
    select: { id: true, status: true, receivingAddress: true, gatewayAddressIndex: true, tokenContract: true },
  });
  return rows.map((r) => ({
    depositId: r.id,
    status: r.status,
    receivingAddress: r.receivingAddress!,
    addressIndex: r.gatewayAddressIndex!,
    tokenContract: r.tokenContract,
  }));
}

export async function startGatewaySweep(input: {
  depositId: string;
  network: string;
  fromAddress: string;
  toAddress: string;
  tokenContract: string;
  tokenDecimals: number;
  rawAmount: bigint;
}): Promise<GatewaySweep> {
  return prisma.gatewaySweep.create({
    data: { ...input, rawAmount: input.rawAmount.toString(), status: "PENDING" },
  });
}

export async function updateGatewaySweep(
  id: string,
  patch: {
    status: GatewaySweepStatus;
    gasTopUpTxHash?: string;
    gasTopUpRaw?: bigint;
    sweepTxHash?: string;
    error?: string;
  },
): Promise<GatewaySweep> {
  const { gasTopUpRaw, ...rest } = patch;
  return prisma.gatewaySweep.update({
    where: { id },
    data: { ...rest, ...(gasTopUpRaw !== undefined ? { gasTopUpRaw: gasTopUpRaw.toString() } : {}) },
  });
}

/** Attempts an earlier run left unfinished (interrupted, or a tx not yet confirmed). */
export async function listOpenGatewaySweeps(network: string): Promise<GatewaySweep[]> {
  return prisma.gatewaySweep.findMany({
    where: { network, status: { in: ["PENDING", "GAS_SENT", "SUBMITTED"] } },
    orderBy: { createdAt: "asc" },
  });
}
