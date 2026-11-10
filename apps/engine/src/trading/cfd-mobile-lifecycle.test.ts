import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { cfdSpreadFeeMinor } from "@asm/contracts";
import { createInternalApi } from "../internal-api";
import { CfdDesk } from "./cfd-desk";

const SECRET = "isolated-mobile-lifecycle-test";
let userId = "";
let accountId = "";
let assetId = "";
let origin = "";
let treasuryBefore: number | null = null;
let api: ReturnType<typeof createInternalApi>;
const symbol = `CFDMOBILE_${randomUUID().slice(0, 8).toUpperCase()}`;

beforeAll(async () => {
  treasuryBefore = (await prisma.houseTreasury.findUnique({ where: { id: 1 } }))?.treasuryMinor ?? null;
  await prisma.houseTreasury.upsert({ where: { id: 1 }, create: { id: 1, treasuryMinor: 30_000_000 }, update: { treasuryMinor: 30_000_000 } });
  const user = await prisma.user.create({ data: { email: `cfd-mobile-${randomUUID()}@test.local`, passwordHash: "test-only" } });
  userId = user.id;
  const account = await prisma.account.create({ data: { userId, type: "DEMO", currency: "INR", realBalance: 1_000_000 } });
  accountId = account.id;
  const asset = await prisma.asset.create({ data: { symbol, displayName: "Deterministic mobile lifecycle fixture", kind: "OTC", spreadBps: 5 } });
  assetId = asset.id;
  // Inject a deterministic provider boundary; production quote/session checks remain unchanged.
  api = createInternalApi({ port: 0, secret: SECRET, tradingModel: "CFD", cfdDesk: new CfdDesk(), shownMidPrice: () => 100,
    marketStatus: () => "open", desk: { open: async () => { throw new Error("Binary trading is outside this fixture"); } } });
  origin = `http://127.0.0.1:${await api.listen()}`;
});

afterAll(async () => {
  await api?.close();
  if (userId) await prisma.user.delete({ where: { id: userId } });
  if (assetId) await prisma.asset.delete({ where: { id: assetId } });
  if (treasuryBefore === null) await prisma.houseTreasury.deleteMany({ where: { id: 1 } });
  else await prisma.houseTreasury.update({ where: { id: 1 }, data: { treasuryMinor: treasuryBefore } });
  await prisma.$disconnect();
});

async function call(path: string, body: unknown, secret = SECRET) {
  return fetch(origin + path, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

it("opens and closes a CFD over HTTP with exact fee accounting and no duplicate payout", async () => {
  const order = { actorId: userId, accountId, symbol, currency: "INR", direction: "LONG", stake: 10_000, durationSec: 300 };
  expect((await call("/cfd/trades", order, "incorrect-test-secret")).status).toBe(401);
  const stale = await call("/cfd/trades", { ...order, currency: "USD" });
  const refused = await stale.json();
  expect({ status: stale.status, body: refused }).toMatchObject({ status: 409, body: { error: "currency_changed" } });
  expect(await prisma.trade.count({ where: { accountId } })).toBe(0);

  const opened = await call("/cfd/trades", order);
  expect(opened.status).toBe(201);
  const result = await opened.json() as { trade: { id: string; direction: string; spreadFee: number }; balances: { realBalance: number } };
  const fee = cfdSpreadFeeMinor(10_000, 5);
  expect(result.trade).toMatchObject({ direction: "LONG", spreadFee: fee });
  expect(result.balances.realBalance).toBe(1_000_000 - 10_000 - fee);
  // Advance only this fixture's entry time beyond the manual-close lockout; no sleep or production clock override.
  await prisma.trade.update({ where: { id: result.trade.id }, data: { entryTs: new Date(Date.now() - 60_000) } });
  expect((await call(`/cfd/trades/${result.trade.id}/close`, {})).status).toBe(200);
  expect((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).realBalance).toBe(1_000_000 - fee);
  expect((await call(`/cfd/trades/${result.trade.id}/close`, {})).status).toBe(409);
  expect((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).realBalance).toBe(1_000_000 - fee);
});
