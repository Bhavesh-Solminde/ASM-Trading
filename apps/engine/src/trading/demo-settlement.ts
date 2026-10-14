/**
 * Demo settlement exits — the inverted-majority rule.
 *
 * Demos never steer the chart, so their exit price is decided at settlement
 * from the verdict stamped at open (a DEMO_WIN_RATE roll). Co-direction demos
 * in one expiry bucket are grouped:
 *
 *   - Group of DEMO_GROUP_MIN_SIZE or more: if at least
 *     DEMO_GROUP_LOSS_THRESHOLD of them stamped LOSS, every demo in the group
 *     loses; otherwise every demo in the group wins. Concurrent demos never
 *     show outcomes that visibly disagree with each other.
 *   - Smaller group: each demo settles by its own stamped verdict, so a
 *     one-at-a-time demo trader sees DEMO_WIN_RATE.
 *
 * HONEST and unstamped demos get no entry here — they settle on the chart.
 */

import type { Position } from "@asm/trading";

export const DEMO_GROUP_MIN_SIZE = 5;
export const DEMO_GROUP_LOSS_THRESHOLD = 0.6;

/** One tick past the entry on the winning or losing side of `direction`. */
function exitFor(
  direction: Position["direction"],
  win: boolean,
  minEntry: number,
  maxEntry: number,
  tickSize: number,
): number {
  if (direction === "UP") return win ? maxEntry + tickSize : minEntry - tickSize;
  return win ? minEntry - tickSize : maxEntry + tickSize;
}

/** Map of tradeId → forced exit price for every stamped demo in the bucket. */
export function demoSettlementExits(
  positions: readonly Position[],
  tickSize: number,
  precision: number,
): Map<string, number> {
  const byDirection = new Map<Position["direction"], Position[]>();
  for (const p of positions) {
    if (!p.isDemo) continue;
    if (!p.verdict || p.verdict === "HONEST") continue;
    const list = byDirection.get(p.direction) ?? [];
    list.push(p);
    byDirection.set(p.direction, list);
  }

  const exits = new Map<string, number>();
  const round = (v: number): number => Number(v.toFixed(precision));

  for (const [direction, group] of byDirection) {
    if (group.length < DEMO_GROUP_MIN_SIZE) {
      for (const p of group) {
        const exit = exitFor(direction, p.verdict === "WIN", p.entryPrice, p.entryPrice, tickSize);
        exits.set(p.tradeId, round(exit));
      }
      continue;
    }

    let lossCount = 0;
    let minE = group[0]!.entryPrice;
    let maxE = minE;
    for (const p of group) {
      if (p.verdict === "LOSS") lossCount += 1;
      if (p.entryPrice < minE) minE = p.entryPrice;
      if (p.entryPrice > maxE) maxE = p.entryPrice;
    }
    const majorityLoss = lossCount / group.length >= DEMO_GROUP_LOSS_THRESHOLD;
    const exit = round(exitFor(direction, !majorityLoss, minE, maxE, tickSize));
    for (const p of group) exits.set(p.tradeId, exit);
  }

  return exits;
}
