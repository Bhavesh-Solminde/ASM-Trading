import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import { DEMO_GROUP_MIN_SIZE, demoSettlementExits } from "./demo-settlement";

const TICK = 0.01;
const PRECISION = 2;

function demo(
  tradeId: string,
  verdict: Position["verdict"],
  partial: Partial<Position> = {},
): Position {
  return {
    tradeId,
    accountId: "acc-1",
    assetId: "asset-1",
    direction: "UP",
    stake: 100,
    payoutPct: 92,
    entryPrice: 100,
    expirySec: 60,
    entrySec: 30,
    isDemo: true,
    ...(verdict !== undefined ? { verdict } : {}),
    ...partial,
  };
}

/** True when `exit` is a win for `p` (strictly in its direction). */
function wins(p: Position, exit: number): boolean {
  return p.direction === "UP" ? exit > p.entryPrice : exit < p.entryPrice;
}

describe("demoSettlementExits — groups below the minimum size", () => {
  it("settles a lone LOSS-stamped UP demo as a loss", () => {
    const p = demo("t1", "LOSS");
    const exit = demoSettlementExits([p], TICK, PRECISION).get("t1")!;
    expect(wins(p, exit)).toBe(false);
  });

  it("settles a lone LOSS-stamped DOWN demo as a loss", () => {
    const p = demo("t1", "LOSS", { direction: "DOWN" });
    const exit = demoSettlementExits([p], TICK, PRECISION).get("t1")!;
    expect(wins(p, exit)).toBe(false);
  });

  it("settles a lone WIN-stamped demo as a win, one tick past entry", () => {
    const p = demo("t1", "WIN");
    expect(demoSettlementExits([p], TICK, PRECISION).get("t1")).toBe(100.01);
  });

  it("settles each demo in a small group by its own verdict", () => {
    const group = [
      demo("w1", "WIN", { entryPrice: 100 }),
      demo("l1", "LOSS", { entryPrice: 101 }),
      demo("w2", "WIN", { entryPrice: 99 }),
      demo("l2", "LOSS", { entryPrice: 100.5 }),
    ];
    expect(group.length).toBeLessThan(DEMO_GROUP_MIN_SIZE);
    const exits = demoSettlementExits(group, TICK, PRECISION);
    for (const p of group) {
      expect(wins(p, exits.get(p.tradeId)!)).toBe(p.verdict === "WIN");
    }
  });
});

describe("demoSettlementExits — groups at or above the minimum size", () => {
  it("loses every demo when at least 60% stamped LOSS", () => {
    const group = [
      demo("a", "LOSS"),
      demo("b", "LOSS"),
      demo("c", "LOSS"),
      demo("d", "WIN"),
      demo("e", "WIN"),
    ];
    const exits = demoSettlementExits(group, TICK, PRECISION);
    for (const p of group) expect(wins(p, exits.get(p.tradeId)!)).toBe(false);
  });

  it("wins every demo when fewer than 60% stamped LOSS", () => {
    const group = [
      demo("a", "LOSS"),
      demo("b", "LOSS"),
      demo("c", "WIN"),
      demo("d", "WIN"),
      demo("e", "WIN"),
    ];
    const exits = demoSettlementExits(group, TICK, PRECISION);
    for (const p of group) expect(wins(p, exits.get(p.tradeId)!)).toBe(true);
  });

  it("gives the whole group one shared exit beyond every entry", () => {
    const group = ["a", "b", "c", "d", "e"].map((id, i) =>
      demo(id, "LOSS", { direction: "DOWN", entryPrice: 100 + i }),
    );
    const exits = demoSettlementExits(group, TICK, PRECISION);
    expect(new Set(exits.values())).toEqual(new Set([104.01]));
  });
});

describe("demoSettlementExits — positions it leaves alone", () => {
  it("returns no exit for live, HONEST or unstamped trades", () => {
    const exits = demoSettlementExits(
      [
        demo("live", "LOSS", { isDemo: false }),
        demo("honest", "HONEST"),
        demo("unstamped", undefined),
      ],
      TICK,
      PRECISION,
    );
    expect(exits.size).toBe(0);
  });
});
