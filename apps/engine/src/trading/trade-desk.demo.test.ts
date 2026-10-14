import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// USE_GLG_TREASURY is read once at import, so it must be set before the desk
// loads. Demos only got a forced exit when a governor was on.
const previousGlg = vi.hoisted(() => {
  const previous = process.env["USE_GLG_TREASURY"];
  process.env["USE_GLG_TREASURY"] = "on";
  return previous;
});

import { createAccountsForUser, prisma } from "@asm/db";
import type { ServerMessage } from "@asm/contracts";
import { AssetRegistry } from "../assets/registry";
import { TradeDesk } from "./trade-desk";
import { ControllerBridge } from "../algo/controller-bridge";

const RUN = randomUUID();
const SYMBOL = "AUDNZD_OTC";
const registry = new AssetRegistry(7);
const notifier: {
  sendToUser: (userId: string, message: ServerMessage) => void;
  broadcast: (symbol: string, message: ServerMessage) => void;
} = { sendToUser: () => {}, broadcast: () => {} };
let desk: TradeDesk;
let seq = 0;

beforeAll(async () => {
  await registry.loadSymbols([SYMBOL]);
  desk = new TradeDesk(registry, notifier, new ControllerBridge(7));
});

afterAll(async () => {
  await desk.idle();
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  if (previousGlg === undefined) delete process.env["USE_GLG_TREASURY"];
  else process.env["USE_GLG_TREASURY"] = previousGlg;
});

async function demoTrader(): Promise<{ userId: string; accountId: string }> {
  seq += 1;
  const user = await prisma.user.create({
    data: { email: `desk-demo-${RUN}-${seq}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  return { userId: user.id, accountId: accounts.find((a) => a.type === "DEMO")!.id };
}

function setPrice(price: number): void {
  const asset = registry.get(SYMBOL)!;
  asset.state = { ...asset.state, price };
  asset.honestState = { ...asset.honestState, price };
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("TradeDesk demo settlement", () => {
  it.each([
    { direction: "UP" as const, chart: 1.1745, status: "LOST" },
    { direction: "UP" as const, chart: 1.1755, status: "WON" },
    { direction: "DOWN" as const, chart: 1.1745, status: "WON" },
    { direction: "DOWN" as const, chart: 1.1755, status: "LOST" },
  ])(
    "a $direction demo settles at the chart price ($chart) and is $status",
    async ({ direction, chart, status }) => {
      const t = await demoTrader();
      setPrice(1.175);
      const { trade } = await desk.open({
        symbol: SYMBOL,
        direction,
        stake: 1_000,
        durationSec: 5,
        accountId: t.accountId,
        actorId: t.userId,
      });

      setPrice(chart);
      desk.collectDue(nowSec() + 10);
      await desk.idle();

      const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
      expect(row.verdict).toBe("HONEST");
      expect(row.exitPrice).toBe(chart);
      expect(row.status).toBe(status);
    },
  );
});
