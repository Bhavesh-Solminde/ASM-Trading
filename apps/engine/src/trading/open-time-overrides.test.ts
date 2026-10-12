import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import {
  applyOpenTimeOverrides,
  BATCH_RULE_MIN_SIZE,
  BATCH_RULE_WIN_THRESHOLD,
  expiryTickBucket,
  targetPriceFor,
  type PendingTrade,
} from "./open-time-overrides";

const TICK = 1;
const ENTRY = 100;

function pos(partial: Partial<Position> & Pick<Position, "tradeId">): Position {
  return {
    tradeId: partial.tradeId,
    accountId: partial.accountId ?? "acc-1",
    assetId: partial.assetId ?? "asset-1",
    direction: partial.direction ?? "UP",
    stake: partial.stake ?? 100,
    payoutPct: partial.payoutPct ?? 85,
    entryPrice: partial.entryPrice ?? ENTRY,
    expirySec: partial.expirySec ?? 60,
    entrySec: partial.entrySec ?? 0,
    isDemo: partial.isDemo ?? false,
    isAffiliate: partial.isAffiliate ?? false,
    ...(partial.verdict !== undefined ? { verdict: partial.verdict } : {}),
    ...(partial.pathStyle !== undefined ? { pathStyle: partial.pathStyle } : {}),
    ...(partial.targetPrice !== undefined
      ? { targetPrice: partial.targetPrice }
      : {}),
  };
}

function pending(partial: Partial<PendingTrade> = {}): PendingTrade {
  const direction = partial.direction ?? "UP";
  const entryPrice = partial.entryPrice ?? ENTRY;
  const verdict = partial.verdict ?? "WIN";
  return {
    direction,
    stake: partial.stake ?? 100,
    durationSec: partial.durationSec ?? 60,
    entryPrice,
    expirySec: partial.expirySec ?? 60,
    isDemo: partial.isDemo ?? false,
    accountId: partial.accountId ?? "acc-1",
    verdict,
    pathStyle: partial.pathStyle ?? "DIRECT",
    targetPrice:
      partial.targetPrice ?? targetPriceFor(verdict, direction, entryPrice, TICK),
  };
}

describe("targetPriceFor", () => {
  it("WIN UP returns entry + tick", () => {
    expect(targetPriceFor("WIN", "UP", 100, 1)).toBe(101);
  });
  it("WIN DOWN returns entry - tick", () => {
    expect(targetPriceFor("WIN", "DOWN", 100, 1)).toBe(99);
  });
  it("LOSS UP returns entry - tick", () => {
    expect(targetPriceFor("LOSS", "UP", 100, 1)).toBe(99);
  });
  it("LOSS DOWN returns entry + tick", () => {
    expect(targetPriceFor("LOSS", "DOWN", 100, 1)).toBe(101);
  });
  it("HONEST returns entry", () => {
    expect(targetPriceFor("HONEST", "UP", 100, 1)).toBe(100);
    expect(targetPriceFor("HONEST", "DOWN", 100, 1)).toBe(100);
  });
});

describe("expiryTickBucket", () => {
  it("floors to the TICK_DT_SEC grid", () => {
    expect(expiryTickBucket(60)).toBe(60);
    expect(expiryTickBucket(61)).toBe(60);
    expect(expiryTickBucket(64)).toBe(60);
    expect(expiryTickBucket(65)).toBe(65);
    expect(expiryTickBucket(67)).toBe(65);
  });
});

describe("applyOpenTimeOverrides demo guard", () => {
  it("demos never trigger either rule", () => {
    const p = pending({ isDemo: true, verdict: "WIN" });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [
        pos({
          tradeId: "t1",
          direction: "UP",
          stake: 10000,
          verdict: "WIN",
          isDemo: false,
        }),
      ],
      userPositionsOnAsset: [],
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });
});

describe("applyOpenTimeOverrides heavy-side cascade", () => {
  it("no flip when pending is alone in the bucket", () => {
    const p = pending({ verdict: "WIN" });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: [],
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it("flips existing WIN on heavier side", () => {
    const p = pending({
      verdict: "WIN",
      direction: "DOWN",
      stake: 500,
      accountId: "acc-2",
    });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [
        pos({ tradeId: "e1", direction: "UP", stake: 1000, verdict: "WIN", accountId: "acc-1" }),
        pos({ tradeId: "e2", direction: "UP", stake: 1000, verdict: "WIN", accountId: "acc-3" }),
      ],
      userPositionsOnAsset: [],
      tickSize: TICK,
    });
    expect(flipped.get("e1")?.verdict).toBe("LOSS");
    expect(flipped.get("e2")?.verdict).toBe("LOSS");
    expect(p.verdict).toBe("WIN");
  });

  it("flips the pending trade when it lands on the heavier side", () => {
    const p = pending({ verdict: "WIN", direction: "UP", stake: 10000, accountId: "acc-2" });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [
        pos({ tradeId: "e1", direction: "DOWN", stake: 500, verdict: "WIN", accountId: "acc-1" }),
      ],
      userPositionsOnAsset: [],
      tickSize: TICK,
    });
    expect(p.verdict).toBe("LOSS");
    expect(flipped.size).toBe(0);
  });

  it("HONEST stamps are never flipped", () => {
    const p = pending({ verdict: "HONEST", direction: "UP", stake: 10000 });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [
        pos({ tradeId: "e1", direction: "DOWN", stake: 100, verdict: "HONEST" }),
      ],
      userPositionsOnAsset: [],
      tickSize: TICK,
    });
    expect(p.verdict).toBe("HONEST");
    expect(flipped.size).toBe(0);
  });

  it("demo bucket positions are ignored", () => {
    const p = pending({ verdict: "WIN", direction: "UP", stake: 10000 });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [
        pos({
          tradeId: "demo-1",
          direction: "DOWN",
          stake: 50000,
          verdict: "WIN",
          isDemo: true,
        }),
      ],
      userPositionsOnAsset: [],
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it("single-direction bucket does not flip", () => {
    const p = pending({ verdict: "WIN", direction: "UP", stake: 100 });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [
        pos({ tradeId: "e1", direction: "UP", stake: 100, verdict: "WIN" }),
      ],
      userPositionsOnAsset: [],
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it("flipped trade's targetPrice is on the opposite side of entry", () => {
    const p = pending({ verdict: "WIN", direction: "DOWN", stake: 500, accountId: "acc-2" });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [
        pos({
          tradeId: "up-win",
          direction: "UP",
          stake: 10000,
          verdict: "WIN",
          entryPrice: 100,
        }),
      ],
      userPositionsOnAsset: [],
      tickSize: TICK,
    });
    const flip = flipped.get("up-win")!;
    expect(flip.verdict).toBe("LOSS");
    expect(flip.targetPrice).toBe(99);
  });
});

describe("applyOpenTimeOverrides LIVE batch rule", () => {
  function makeUserBatch(size: number, winCount: number): Position[] {
    const positions: Position[] = [];
    for (let i = 0; i < size; i++) {
      positions.push(
        pos({
          tradeId: `t-${i}`,
          accountId: "acc-1",
          direction: "UP",
          stake: 100,
          verdict: i < winCount ? "WIN" : "LOSS",
          expirySec: 60,
          entrySec: 0,
        }),
      );
    }
    return positions;
  }

  it(`does not fire when batch size < ${BATCH_RULE_MIN_SIZE}`, () => {
    const p = pending({ verdict: "WIN", expirySec: 61 });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: makeUserBatch(3, 0),
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it(`fires at batch size === ${BATCH_RULE_MIN_SIZE} with below threshold`, () => {
    const p = pending({ verdict: "WIN", expirySec: 61 });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: makeUserBatch(4, 1),
      tickSize: TICK,
    });
    expect(p.verdict).toBe("LOSS");
    expect(flipped.get("t-0")?.verdict).toBe("LOSS");
    expect(flipped.has("t-1")).toBe(false);
    expect(flipped.has("t-2")).toBe(false);
    expect(flipped.has("t-3")).toBe(false);
  });

  it(`keeps stamps when WIN ratio >= ${BATCH_RULE_WIN_THRESHOLD}`, () => {
    const p = pending({ verdict: "WIN", expirySec: 61 });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: makeUserBatch(4, 3),
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it("exactly 60% WIN keeps the batch", () => {
    const p = pending({ verdict: "WIN", expirySec: 61 });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: makeUserBatch(4, 2),
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it("only groups positions in the same expiry-tick bucket", () => {
    const p = pending({ verdict: "WIN", expirySec: 61 });
    const positions: Position[] = [];
    for (let i = 0; i < 3; i++) {
      positions.push(pos({ tradeId: `in-${i}`, verdict: "LOSS", expirySec: 60, entrySec: 0 }));
    }
    for (let i = 0; i < 3; i++) {
      positions.push(pos({ tradeId: `out-${i}`, verdict: "WIN", expirySec: 66, entrySec: 0 }));
    }
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: positions,
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it("only groups the pending trade's own accountId", () => {
    const p = pending({ verdict: "WIN", expirySec: 61, accountId: "acc-A" });
    const positions: Position[] = [];
    for (let i = 0; i < 5; i++) {
      positions.push(
        pos({
          tradeId: `b-${i}`,
          accountId: "acc-B",
          verdict: "LOSS",
          expirySec: 60,
          entrySec: 0,
        }),
      );
    }
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: positions,
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it("demos are excluded from the batch", () => {
    const p = pending({ verdict: "WIN", expirySec: 61 });
    const positions: Position[] = [];
    for (let i = 0; i < 10; i++) {
      positions.push(
        pos({
          tradeId: `d-${i}`,
          verdict: "LOSS",
          expirySec: 60,
          entrySec: 0,
          isDemo: true,
        }),
      );
    }
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: positions,
      tickSize: TICK,
    });
    expect(p.verdict).toBe("WIN");
    expect(flipped.size).toBe(0);
  });

  it("large batch with mostly LOSS stamps flips every WIN", () => {
    const positions: Position[] = [];
    for (let i = 0; i < 9; i++) {
      positions.push(
        pos({
          tradeId: `b-${i}`,
          verdict: i < 3 ? "WIN" : "LOSS",
          expirySec: 60,
          entrySec: 0,
        }),
      );
    }
    const p = pending({ verdict: "WIN", expirySec: 61 });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [],
      userPositionsOnAsset: positions,
      tickSize: TICK,
    });
    expect(p.verdict).toBe("LOSS");
    expect(flipped.get("b-0")?.verdict).toBe("LOSS");
    expect(flipped.get("b-1")?.verdict).toBe("LOSS");
    expect(flipped.get("b-2")?.verdict).toBe("LOSS");
    expect(flipped.has("b-3")).toBe(false);
  });
});

describe("applyOpenTimeOverrides rules compose", () => {
  it("heavy-side cascade runs before the batch rule", () => {
    const existing: Position[] = [];
    for (let i = 0; i < 5; i++) {
      existing.push(
        pos({
          tradeId: `u-${i}`,
          accountId: "acc-1",
          direction: "UP",
          stake: 1000,
          verdict: i < 3 ? "WIN" : "LOSS",
          expirySec: 60,
          entrySec: 0,
        }),
      );
    }
    const other = pos({
      tradeId: "d-1",
      accountId: "acc-2",
      direction: "DOWN",
      stake: 100,
      verdict: "WIN",
      expirySec: 60,
      entrySec: 0,
    });
    const p = pending({
      verdict: "WIN",
      direction: "UP",
      stake: 1000,
      expirySec: 61,
      accountId: "acc-1",
    });
    const flipped = applyOpenTimeOverrides({
      pending: p,
      bucketPositions: [...existing, other],
      userPositionsOnAsset: existing,
      tickSize: TICK,
    });
    expect(flipped.get("u-0")?.verdict).toBe("LOSS");
    expect(flipped.get("u-1")?.verdict).toBe("LOSS");
    expect(flipped.get("u-2")?.verdict).toBe("LOSS");
    expect(p.verdict).toBe("LOSS");
    expect(flipped.has("d-1")).toBe(false);
  });
});
