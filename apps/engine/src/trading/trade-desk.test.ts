import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccountsForUser, openTrade, prisma } from "@asm/db";
import { expirySecFor } from "@asm/trading";
import type { ServerMessage } from "@asm/contracts";
import { AssetRegistry } from "../assets/registry";
import { TradeDesk } from "./trade-desk";
import { ControllerBridge } from "../algo/controller-bridge";

const RUN = randomUUID();
const registry = new AssetRegistry(7);
const sent: { userId: string; message: ServerMessage }[] = [];
const broadcasts: { symbol: string; message: ServerMessage }[] = [];
const notifier = {
  sendToUser: (userId: string, message: ServerMessage) =>
    sent.push({ userId, message }),
  broadcast: (symbol: string, message: ServerMessage) =>
    broadcasts.push({ symbol, message }),
};
const controller = new ControllerBridge(7);
let desk: TradeDesk;
let seq = 0;

beforeAll(async () => {
  // Load AUDNZD_OTC explicitly (it is closed since the BTC/Gold-only switch):
  // the desk logic under test is asset-agnostic and this keeps the OTC fixture.
  await registry.loadSymbols(["AUDNZD_OTC"]);
  desk = new TradeDesk(registry, notifier, controller);
});

afterAll(async () => {
  await desk.idle();
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function trader(balance = 1_000_000): Promise<{ userId: string; accountId: string }> {
  seq += 1;
  const user = await prisma.user.create({
    data: { email: `desk-${RUN}-${seq}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, balance);
  return { userId: user.id, accountId: accounts.find((a) => a.type === "DEMO")!.id };
}

function setPrice(price: number): void {
  const asset = registry.get("AUDNZD_OTC")!;
  asset.state = { ...asset.state, price };
  // Keep the honest path in step with the manually-driven shown path.
  // Otherwise `honestState` sits at its init value forever (no ticks run in
  // this suite), and Phase 2C's snap-to-honest fallback correctly identifies
  // the fabricated gap between shown and honest and snaps every settlement
  // back to the stale init price — a real behavior, but not what these
  // settlement-mechanics tests exist to verify.
  asset.honestState = { ...asset.honestState, price };
}

const nowSec = () => Math.floor(Date.now() / 1000);

function request(t: { userId: string; accountId: string }, overrides: Record<string, unknown> = {}) {
  return {
    symbol: "AUDNZD_OTC",
    direction: "UP" as const,
    stake: 1_000,
    durationSec: 5,
    accountId: t.accountId,
    actorId: t.userId,
    ...overrides,
  };
}

describe("TradeDesk.open", () => {
  it("opens at the engine's own price, registers the position, and notifies the owner", async () => {
    const t = await trader();
    setPrice(1.175);
    const result = await desk.open(request(t));

    expect(result.trade.entryPrice).toBe(1.175);
    expect(result.trade.status).toBe("OPEN");
    expect(result.balances.realBalance).toBe(999_000);

    const assetId = registry.get("AUDNZD_OTC")!.id;
    expect(desk.openFor(assetId).some((p) => p.tradeId === result.trade.id)).toBe(true);

    const mine = sent.filter((s) => s.userId === t.userId).map((s) => s.message.type);
    expect(mine).toEqual(["trade:opened", "balance:update"]);
  });

  it("rejects an account the actor does not own", async () => {
    const owner = await trader();
    const stranger = await trader();
    await expect(
      desk.open(request(owner, { actorId: stranger.userId })),
    ).rejects.toMatchObject({ reason: "account_not_found" });
    expect(await prisma.trade.count({ where: { accountId: owner.accountId } })).toBe(0);
  });

  it("rejects a stake larger than the balance", async () => {
    const t = await trader(500);
    await expect(desk.open(request(t))).rejects.toMatchObject({ reason: "insufficient_funds" });
  });

  it("rejects an unknown asset", async () => {
    const t = await trader();
    await expect(desk.open(request(t, { symbol: "NOPE_OTC" }))).rejects.toMatchObject({
      reason: "unknown_asset",
    });
  });
});

describe("TradeDesk.open when the write outlasts the trade", () => {
  it("voids a trade whose expiry second passed before it could join the book", async () => {
    const t = await trader();
    setPrice(1.175);
    // Each clock read jumps 10s: entry is stamped at the first read, and by the
    // post-commit check a 5s trade's expiry second has already gone by.
    let clock = Date.now();
    const slow = new TradeDesk(registry, notifier, controller, () => (clock += 10_000));

    const result = await slow.open(request(t, { durationSec: 5 }));

    expect(result.trade.status).toBe("REFUNDED");
    expect(result.trade.exitPrice).toBeNull();
    expect(result.balances.realBalance).toBe(1_000_000);
    const assetId = registry.get("AUDNZD_OTC")!.id;
    expect(slow.openFor(assetId).some((p) => p.tradeId === result.trade.id)).toBe(false);
    const row = await prisma.trade.findUniqueOrThrow({ where: { id: result.trade.id } });
    expect(row.status).toBe("REFUNDED");
  });
});

describe("TradeDesk settlement", () => {
  it("settles at the price captured when the bucket came due, not when the write happens", async () => {
    const t = await trader();
    setPrice(1.175);
    const { trade } = await desk.open(request(t));

    setPrice(1.176);
    desk.collectDue(nowSec() + 10); // captures 1.176 synchronously
    setPrice(1.17); // moves before the database write lands
    await desk.idle();

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.status).toBe("WON");
    expect(row.exitPrice).toBe(1.176);
    expect(
      sent.some((s) => s.userId === t.userId && s.message.type === "trade:settled"),
    ).toBe(true);
  });

  it("snaps the shown chart to the resolved exit price when the resolver picks a different candidate", async () => {
    // The exact bug a real user hit: they placed a BUY, the chart moved
    // above entry (they'd visually won), but under house-first the resolver
    // picked entryPrice-tick to make UP lose. Without the settlement snap
    // the chart's last visible price stays above entry while the settled
    // exit sits below entry — "my chart said WON but the trade says LOST".
    //
    // Setup: a single UP trade — house-first says UP is the losing side, so
    // the resolver will pick entryPrice - tick. We move the shown chart to
    // 1.178 (well above entry) before capture so shown and resolved differ
    // by more than 1 tick, then assert a `tick` broadcast at the resolved
    // price fires and asset.state.price is updated to match.
    broadcasts.length = 0;
    const t = await trader();
    setPrice(1.175);
    const { trade } = await desk.open(request(t, { direction: "UP" }));

    // Push shown ~10 ticks above entry — comfortably inside maxMove so the
    // resolver can also reach `entryPrice - tick` from the same window
    // (this is the whole point: chart is above entry, resolver picks below).
    setPrice(1.17510);
    desk.collectDue(nowSec() + 10);
    await desk.idle();

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    // Under house-first a single UP wish loses → exit at entryPrice - tick.
    expect(row.status).toBe("LOST");
    expect(row.exitPrice).toBeLessThan(1.175);

    // The settlement snap must have (a) broadcast a tick at the resolved
    // exit price so watchers see the chart complete the move, and (b)
    // updated asset.state.price so the next tick continues from there
    // rather than from the drifted 1.178 the resolver rejected.
    const snapTick = broadcasts.find(
      (b) =>
        b.symbol === "AUDNZD_OTC" &&
        b.message.type === "tick" &&
        Math.abs(b.message.price - row.exitPrice!) < 1e-9,
    );
    expect(snapTick).toBeDefined();
    const asset = registry.get("AUDNZD_OTC")!;
    expect(Number(asset.state.price.toFixed(asset.precision))).toBe(
      row.exitPrice,
    );
  });
});

describe("TradeDesk.hydrate", () => {
  it("voids a position whose expiry passed while the engine was down", async () => {
    const t = await trader();
    const assetId = registry.get("AUDNZD_OTC")!.id;
    const { trade } = await openTrade({
      accountId: t.accountId,
      assetId,
      direction: "UP",
      stake: 1_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(Date.now() - 120_000),
      expiryTs: new Date(Date.now() - 60_000),
    });

    await new TradeDesk(registry, notifier, controller).hydrate(nowSec());

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.status).toBe("REFUNDED");
    expect(row.exitPrice).toBeNull();
    const account = await prisma.account.findUniqueOrThrow({ where: { id: t.accountId } });
    expect(account.realBalance).toBe(1_000_000);
  });

  it("keeps a position that is not yet due", async () => {
    const t = await trader();
    const assetId = registry.get("AUDNZD_OTC")!.id;
    const { trade } = await openTrade({
      accountId: t.accountId,
      assetId,
      direction: "UP",
      stake: 1_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(Date.now() + 60_000),
    });

    const fresh = new TradeDesk(registry, notifier, controller);
    await fresh.hydrate(nowSec());
    expect(fresh.openFor(assetId).some((p) => p.tradeId === trade.id)).toBe(true);
  });

  it("voids a position expiring in the restart second, and keeps one expiring the second after", async () => {
    const t = await trader();
    const assetId = registry.get("AUDNZD_OTC")!.id;
    const expiryTs = new Date(Date.now() + 60_000);
    const open = (id: string) =>
      openTrade({
        accountId: t.accountId,
        assetId,
        direction: "UP",
        stake: 1_000,
        payoutPct: 100,
        entryPrice: 1.175,
        entryTs: new Date(),
        expiryTs,
      }).then((o) => ({ id, tradeId: o.trade.id }));
    const [due, next] = await Promise.all([open("due"), open("next")]);
    const expirySec = expirySecFor(expiryTs.getTime());

    // "next" is judged against the second before its expiry.
    const later = new TradeDesk(registry, notifier, controller);
    await later.hydrate(expirySec - 1);
    expect(later.openFor(assetId).some((p) => p.tradeId === next.tradeId)).toBe(true);

    // At its own expiry second the engine has no price from before the restart.
    await new TradeDesk(registry, notifier, controller).hydrate(expirySec);
    const row = await prisma.trade.findUniqueOrThrow({ where: { id: due.tradeId } });
    expect(row.status).toBe("REFUNDED");
    expect(row.exitPrice).toBeNull();
  });
});
