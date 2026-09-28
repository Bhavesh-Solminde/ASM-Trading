import { prisma } from "../client";
import type { HouseTreasury, TradeStatus } from "../../generated/prisma/client";

/**
 * Read the treasury singleton. Returns the row if seeded (migration inserts
 * it), else null. Trade-desk falls back to a zero-treasury baseline when
 * null — matches the "start clean" seed strategy.
 */
export async function getTreasury(): Promise<HouseTreasury | null> {
  return prisma.houseTreasury.findUnique({ where: { id: 1 } });
}

/**
 * Apply one settled non-DEMO trade to the treasury. Live-only; DEMO trades
 * never move the treasury. Best-effort — a failed upsert must not roll a
 * settled trade back.
 *
 * Sign convention:
 *   LOST     → treasuryMinor += stake  (house keeps the stake)
 *   WON      → treasuryMinor -= payout (house pays out stake × payoutPct/100)
 *   REFUNDED → treasuryMinor += 0
 */
export async function applySettlementToTreasury(input: {
  stake: number;
  payoutPct: number;
  outcome: TradeStatus;
  fallbackTargetMinor: number;
}): Promise<HouseTreasury> {
  const delta =
    input.outcome === "LOST"
      ? input.stake
      : input.outcome === "WON"
        ? -Math.round((input.stake * input.payoutPct) / 100)
        : 0;

  return prisma.houseTreasury.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      treasuryMinor: delta,
      treasuryTargetMinor: input.fallbackTargetMinor,
    },
    update: {
      treasuryMinor: { increment: delta },
    },
  });
}

/**
 * Admin write for the treasury target. Used by the admin dashboard's
 * "healthy treasury" input.
 */
export async function setTreasuryTarget(
  targetMinor: number,
): Promise<HouseTreasury> {
  return prisma.houseTreasury.upsert({
    where: { id: 1 },
    create: { id: 1, treasuryTargetMinor: targetMinor },
    update: { treasuryTargetMinor: targetMinor },
  });
}
