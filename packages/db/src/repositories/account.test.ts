import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import {
  CurrencyChangeRefused,
  DEMO_START_BY_CURRENCY,
  DemoBalanceRefused,
  USD_INR_RATE,
  changeAccountCurrency,
  convertAccountCurrency,
  convertMinorBetween,
  createAccountsForUser,
  demoBalanceCap,
  getAccountForActor,
  listAccountsForActor,
  setDemoBalance,
} from "./account";

let alice = "";
let bob = "";
let carol = "";
let dave = "";
let aliceLiveId = "";
let carolDemoId = "";
let carolLiveId = "";
let daveDemoId = "";
let daveLiveId = "";

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
  const d = await prisma.user.create({
    data: { email: `dave-${Date.now()}@test.local`, passwordHash: "x" },
  });
  alice = a.id;
  bob = b.id;
  carol = c.id;
  dave = d.id;
  const accounts = await createAccountsForUser(alice, 1_000_000);
  await createAccountsForUser(bob, 1_000_000);
  const carolAccounts = await createAccountsForUser(carol, 1_000_000);
  // Dave's DEMO is funded with ₹10,00,000 (paise) so conversion math is exact.
  const daveAccounts = await createAccountsForUser(dave, 100_000_000, "INR");
  aliceLiveId = accounts.find((x) => x.type === "LIVE")!.id;
  carolDemoId = carolAccounts.find((x) => x.type === "DEMO")!.id;
  carolLiveId = carolAccounts.find((x) => x.type === "LIVE")!.id;
  daveDemoId = daveAccounts.find((x) => x.type === "DEMO")!.id;
  daveLiveId = daveAccounts.find((x) => x.type === "LIVE")!.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [alice, bob, carol, dave] } } });
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

describe("convertMinorBetween", () => {
  it("converts INR paise to USD cents at ₹100 = $1", () => {
    // ₹10,00,000 = 100_000_000 paise → $10,000 = 1_000_000 cents.
    expect(convertMinorBetween(100_000_000, "INR", "USD")).toBe(1_000_000);
    expect(USD_INR_RATE).toBe(100);
  });

  it("converts USD cents to INR paise at $1 = ₹100", () => {
    // $100 = 10_000 cents → ₹10,000 = 1_000_000 paise.
    expect(convertMinorBetween(10_000, "USD", "INR")).toBe(1_000_000);
  });

  it("rounds INR→USD to the nearest cent", () => {
    expect(convertMinorBetween(150, "INR", "USD")).toBe(2); // 1.5 → 2
    expect(convertMinorBetween(149, "INR", "USD")).toBe(1); // 1.49 → 1
  });

  it("leaves the amount unchanged for the same currency", () => {
    expect(convertMinorBetween(1234, "INR", "INR")).toBe(1234);
  });
});

describe("convertAccountCurrency", () => {
  it("converts a funded DEMO account INR→USD and ledgers CURRENCY_CONVERT", async () => {
    const updated = await convertAccountCurrency({
      actorId: dave,
      accountId: daveDemoId,
      currency: "USD",
    });
    expect(updated.currency).toBe("USD");
    expect(updated.realBalance).toBe(1_000_000); // ₹10,00,000 → $10,000

    const ledger = await prisma.transaction.findFirst({
      where: { accountId: daveDemoId, kind: "CURRENCY_CONVERT" },
      orderBy: { createdAt: "desc" },
    });
    expect(ledger?.amount).toBe(1_000_000);
  });

  it("converts real and bonus balances of a funded LIVE account (no rail lock)", async () => {
    await prisma.account.update({
      where: { id: daveLiveId },
      data: { realBalance: 1_000_000, bonusBalance: 500_000 }, // ₹10,000 + ₹5,000
    });
    const updated = await convertAccountCurrency({
      actorId: dave,
      accountId: daveLiveId,
      currency: "USD",
    });
    expect(updated.currency).toBe("USD");
    expect(updated.realBalance).toBe(10_000); // ₹10,000 → $100
    expect(updated.bonusBalance).toBe(5_000); // ₹5,000 → $50
  });

  it("is a no-op when the account is already in the target currency", async () => {
    const before = await getAccountForActor(dave, daveLiveId);
    const updated = await convertAccountCurrency({
      actorId: dave,
      accountId: daveLiveId,
      currency: "USD",
    });
    expect(updated.realBalance).toBe(before!.realBalance);
  });

  it("refuses an unsupported currency", async () => {
    await expect(
      convertAccountCurrency({ actorId: dave, accountId: daveDemoId, currency: "EUR" }),
    ).rejects.toBeInstanceOf(CurrencyChangeRefused);
  });

  it("refuses when the actor does not own the account", async () => {
    await expect(
      convertAccountCurrency({ actorId: bob, accountId: daveDemoId, currency: "INR" }),
    ).rejects.toBeInstanceOf(CurrencyChangeRefused);
  });
});

describe("setDemoBalance", () => {
  // carolDemoId is INR by the end of the currency suite above.
  it("sets a custom demo balance and clears any bonus", async () => {
    await prisma.account.update({
      where: { id: carolDemoId },
      data: { bonusBalance: 1_234 },
    });
    const updated = await setDemoBalance({
      actorId: carol,
      accountId: carolDemoId,
      amount: 5_000,
    });
    expect(updated.realBalance).toBe(5_000);
    expect(updated.bonusBalance).toBe(0);

    const reset = await prisma.transaction.findFirst({
      where: { accountId: carolDemoId, kind: "DEMO_RESET", refType: "DemoReset" },
      orderBy: { createdAt: "desc" },
    });
    expect(reset?.amount).toBe(5_000);
  });

  it("resets to the currency's full default when no amount is given", async () => {
    const updated = await setDemoBalance({ actorId: carol, accountId: carolDemoId });
    expect(updated.realBalance).toBe(demoBalanceCap(updated.currency));
    expect(updated.realBalance).toBe(DEMO_START_BY_CURRENCY.INR);
  });

  it("refuses an amount above the cap", async () => {
    await expect(
      setDemoBalance({
        actorId: carol,
        accountId: carolDemoId,
        amount: DEMO_START_BY_CURRENCY.INR! + 1,
      }),
    ).rejects.toBeInstanceOf(DemoBalanceRefused);
  });

  it("refuses a non-positive amount", async () => {
    await expect(
      setDemoBalance({ actorId: carol, accountId: carolDemoId, amount: 0 }),
    ).rejects.toBeInstanceOf(DemoBalanceRefused);
  });

  it("refuses editing a LIVE account", async () => {
    await expect(
      setDemoBalance({ actorId: carol, accountId: carolLiveId, amount: 5_000 }),
    ).rejects.toBeInstanceOf(DemoBalanceRefused);
  });

  it("refuses when the actor does not own the account", async () => {
    await expect(
      setDemoBalance({ actorId: bob, accountId: carolDemoId, amount: 5_000 }),
    ).rejects.toBeInstanceOf(DemoBalanceRefused);
  });
});
