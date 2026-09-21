import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import {
  CurrencyChangeRefused,
  DEMO_START_BY_CURRENCY,
  changeAccountCurrency,
  createAccountsForUser,
  getAccountForActor,
  listAccountsForActor,
} from "./account";

let alice = "";
let bob = "";
let carol = "";
let aliceLiveId = "";
let carolDemoId = "";
let carolLiveId = "";

beforeAll(async () => {
  const a = await prisma.user.create({
    data: { email: `alice-${Date.now()}@test.local`, passwordHash: "x" },
  });
  const b = await prisma.user.create({
    data: { email: `bob-${Date.now()}@test.local`, passwordHash: "x" },
  });
  const c = await prisma.user.create({
    data: { email: `carol-${Date.now()}@test.local`, passwordHash: "x" },
  });
  alice = a.id;
  bob = b.id;
  carol = c.id;
  const accounts = await createAccountsForUser(alice, 1_000_000);
  await createAccountsForUser(bob, 1_000_000);
  const carolAccounts = await createAccountsForUser(carol, 1_000_000);
  aliceLiveId = accounts.find((x) => x.type === "LIVE")!.id;
  carolDemoId = carolAccounts.find((x) => x.type === "DEMO")!.id;
  carolLiveId = carolAccounts.find((x) => x.type === "LIVE")!.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [alice, bob, carol] } } });
  await prisma.$disconnect();
});

describe("account repository", () => {
  it("creates exactly one live and one demo account", async () => {
    const accounts = await listAccountsForActor(alice);
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.type).sort()).toEqual(["DEMO", "LIVE"]);
  });

  it("funds the demo account and leaves live at zero", async () => {
    const accounts = await listAccountsForActor(alice);
    expect(accounts.find((a) => a.type === "DEMO")!.realBalance).toBe(1_000_000);
    expect(accounts.find((a) => a.type === "LIVE")!.realBalance).toBe(0);
  });

  it("returns an owned account to its owner", async () => {
    const account = await getAccountForActor(alice, aliceLiveId);
    expect(account).not.toBeNull();
    expect(account!.userId).toBe(alice);
  });

  it("returns null when another user requests it by id", async () => {
    const account = await getAccountForActor(bob, aliceLiveId);
    expect(account).toBeNull();
  });

  it("never leaks another user's accounts in a list", async () => {
    const accounts = await listAccountsForActor(bob);
    expect(accounts.every((a) => a.userId === bob)).toBe(true);
  });
});

describe("changeAccountCurrency", () => {
  it("re-seeds a DEMO account in the new currency with no conversion", async () => {
    const updated = await changeAccountCurrency({
      actorId: carol,
      accountId: carolDemoId,
      currency: "USD",
    });
    expect(updated.currency).toBe("USD");
    expect(updated.realBalance).toBe(DEMO_START_BY_CURRENCY.USD);
    expect(updated.bonusBalance).toBe(0);

    const reset = await prisma.transaction.findFirst({
      where: { accountId: carolDemoId, kind: "DEMO_RESET" },
      orderBy: { createdAt: "desc" },
    });
    expect(reset?.amount).toBe(DEMO_START_BY_CURRENCY.USD);
  });

  it("re-seeds DEMO play money in rupees when switched back to INR", async () => {
    const updated = await changeAccountCurrency({
      actorId: carol,
      accountId: carolDemoId,
      currency: "INR",
    });
    expect(updated.currency).toBe("INR");
    expect(updated.realBalance).toBe(DEMO_START_BY_CURRENCY.INR);
  });

  it("switches an unfunded LIVE account's currency rail without seeding money", async () => {
    const updated = await changeAccountCurrency({
      actorId: carol,
      accountId: carolLiveId,
      currency: "USD",
    });
    expect(updated.currency).toBe("USD");
    expect(updated.realBalance).toBe(0);
    expect(updated.bonusBalance).toBe(0);
  });

  it("refuses to switch a funded LIVE account's currency", async () => {
    await prisma.account.update({
      where: { id: carolLiveId },
      data: { realBalance: 5_000 },
    });
    try {
      await expect(
        changeAccountCurrency({ actorId: carol, accountId: carolLiveId, currency: "INR" }),
      ).rejects.toBeInstanceOf(CurrencyChangeRefused);
    } finally {
      // Restore shared state so account order/balance assertions stay isolated.
      await prisma.account.update({
        where: { id: carolLiveId },
        data: { realBalance: 0 },
      });
    }
  });

  it("refuses an unsupported currency", async () => {
    await expect(
      changeAccountCurrency({ actorId: carol, accountId: carolDemoId, currency: "EUR" }),
    ).rejects.toBeInstanceOf(CurrencyChangeRefused);
  });

  it("refuses when the actor does not own the account", async () => {
    await expect(
      changeAccountCurrency({ actorId: bob, accountId: carolDemoId, currency: "USD" }),
    ).rejects.toBeInstanceOf(CurrencyChangeRefused);
  });
});
