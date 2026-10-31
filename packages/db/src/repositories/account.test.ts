import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { WithdrawalRefused, requestWithdrawal } from "./withdrawal";
import { ConcurrentModification, openTrade } from "./trade";

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

  it("converts each trade's stake/stakeFromBonus/pnl in the same transaction", async () => {
    // Open an INR account and seed trades on it. Trade rows have no currency
    // column — their minor units are read in the account's current currency —
    // so a convert must rewrite them, or ₹1,000 stakes would render as $1,000
    // after an INR→USD convert (and the gross return on a 92%-payout win as
    // "$1,920" instead of "₹1,920" ↔ "$19.20"). Regression for that bug.
    const u = await prisma.user.create({
      data: { email: `tradeconv-${Date.now()}@test.local`, passwordHash: "x" },
    });
    const accounts = await createAccountsForUser(u.id, 100_000_000, "INR");
    const liveId = accounts.find((a) => a.type === "LIVE")!.id;
    await prisma.account.update({
      where: { id: liveId },
      data: { realBalance: 200_000, bonusBalance: 0 }, // ₹2,000 live
    });
    const asset = await prisma.asset.findFirstOrThrow();
    const openT = await prisma.trade.create({
      data: {
        accountId: liveId,
        assetId: asset.id,
        direction: "UP",
        stake: 100_000, // ₹1,000
        stakeFromBonus: 20_000, // ₹200 from bonus
        payoutPct: 92,
        entryPrice: 1,
        entryTs: new Date(),
        expiryTs: new Date(Date.now() + 60_000),
        // An OPEN trade now blocks the switch (see the open-positions suite),
        // so the in-place rewrite is exercised on a settled (refunded) one.
        status: "REFUNDED",
        pnl: 0,
      },
    });
    const wonT = await prisma.trade.create({
      data: {
        accountId: liveId,
        assetId: asset.id,
        direction: "UP",
        stake: 100_000, // ₹1,000
        payoutPct: 92,
        entryPrice: 1,
        entryTs: new Date(),
        expiryTs: new Date(Date.now() + 60_000),
        exitPrice: 1.1,
        status: "WON",
        pnl: 92_000, // ₹920 profit
      },
    });
    const lostT = await prisma.trade.create({
      data: {
        accountId: liveId,
        assetId: asset.id,
        direction: "UP",
        stake: 50_000, // ₹500
        payoutPct: 92,
        entryPrice: 1,
        entryTs: new Date(),
        expiryTs: new Date(Date.now() + 60_000),
        exitPrice: 0.9,
        status: "LOST",
        pnl: -50_000, // −₹500 loss
      },
    });

    await convertAccountCurrency({ actorId: u.id, accountId: liveId, currency: "USD" });

    const openAfter = await prisma.trade.findUniqueOrThrow({ where: { id: openT.id } });
    expect(openAfter.stake).toBe(1_000); // ₹1,000 paise → 1,000 cents = $10
    expect(openAfter.stakeFromBonus).toBe(200); // ₹200 → $2
    expect(openAfter.pnl).toBe(0);

    const wonAfter = await prisma.trade.findUniqueOrThrow({ where: { id: wonT.id } });
    expect(wonAfter.stake).toBe(1_000);
    expect(wonAfter.pnl).toBe(920); // ₹920 → $9.20 (gross return: $19.20, not $1,920)

    const lostAfter = await prisma.trade.findUniqueOrThrow({ where: { id: lostT.id } });
    expect(lostAfter.stake).toBe(500);
    expect(lostAfter.pnl).toBe(-500); // negative round-trip still exact

    await prisma.user.delete({ where: { id: u.id } });
  });
});

describe("convertAccountCurrency with an in-flight withdrawal", () => {
  // A withdrawal row holds `amount` in the currency of the account at request
  // time and the money is already debited. Converting the account underneath it
  // would make a later cancel/reject refund the wrong magnitude (₹50,000 as
  // $50,000), so a LIVE account with any non-final withdrawal may not switch.
  let uid = "";
  let liveId = "";

  beforeEach(async () => {
    const u = await prisma.user.create({
      data: { email: `pend-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    uid = u.id;
    const accounts = await createAccountsForUser(uid, 0, "INR");
    liveId = accounts.find((x) => x.type === "LIVE")!.id;
    await prisma.account.update({ where: { id: liveId }, data: { realBalance: 5_000_000 } });
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: uid } });
  });

  const withdrawal = (status: "REQUESTED" | "HELD" | "APPROVED" | "PAID" | "REJECTED" | "CANCELLED_BY_USER") =>
    prisma.withdrawal.create({
      data: { userId: uid, amount: 5_000_000, method: "UPI", status, currency: "INR" },
    });

  it.each(["REQUESTED", "HELD", "APPROVED"] as const)(
    "refuses to switch a LIVE account while a %s withdrawal is in flight",
    async (status) => {
      await withdrawal(status);
      const err = await convertAccountCurrency({ actorId: uid, accountId: liveId, currency: "USD" }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CurrencyChangeRefused);
      expect((err as CurrencyChangeRefused).message).toBe("You have a withdrawal in progress. You can switch currency once it is paid or rejected.");
      expect((err as CurrencyChangeRefused).code).toBe("pending_withdrawal");
      // Nothing moved: still INR, balance untouched, no ledger row.
      const after = await prisma.account.findUniqueOrThrow({ where: { id: liveId } });
      expect(after.currency).toBe("INR");
      expect(after.realBalance).toBe(5_000_000);
      expect(await prisma.transaction.count({ where: { accountId: liveId, kind: "CURRENCY_CONVERT" } })).toBe(0);
    },
  );

  it("allows the switch when every withdrawal is final (PAID / REJECTED / CANCELLED_BY_USER)", async () => {
    await withdrawal("PAID");
    await withdrawal("REJECTED");
    await withdrawal("CANCELLED_BY_USER");
    const updated = await convertAccountCurrency({ actorId: uid, accountId: liveId, currency: "USD" });
    expect(updated.currency).toBe("USD");
    expect(updated.realBalance).toBe(50_000);
  });

  it("does not gate a DEMO account (demo accounts cannot withdraw)", async () => {
    await withdrawal("REQUESTED");
    const demo = await prisma.account.findFirstOrThrow({ where: { userId: uid, type: "DEMO" } });
    const updated = await convertAccountCurrency({ actorId: uid, accountId: demo.id, currency: "USD" });
    expect(updated.currency).toBe("USD");
  });

  it("requestWithdrawal refuses when the account currency changes between its read and its debit", async () => {
    await prisma.user.update({ where: { id: uid }, data: { kycStatus: "VERIFIED" } });
    // A transaction that converts the account and commits only after the
    // request has read it (as INR) and queued its debit behind the row lock.
    const hold = prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: liveId },
        data: { currency: "USD", realBalance: 50_000, version: { increment: 1 } },
      });
      await new Promise((r) => setTimeout(r, 600));
    });
    await new Promise((r) => setTimeout(r, 150));
    const request = requestWithdrawal({
      actorId: uid,
      accountId: liveId,
      amount: 100_000, // ₹1,000 as the INR form sent it
      payout: { method: "UPI", upiId: "me@okaxis" },
      destinationKey: "upi:me@okaxis",
    });
    await hold;
    await expect(request).rejects.toThrow(/currency just changed/i);
    expect(await prisma.withdrawal.count({ where: { userId: uid } })).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: liveId } })).realBalance).toBe(50_000);
  });

  it("never lets a withdrawal request and a currency switch both win the same race", async () => {
    await prisma.user.update({ where: { id: uid }, data: { kycStatus: "VERIFIED" } });
    for (let i = 0; i < 6; i++) {
      const [w, c] = await Promise.allSettled([
        requestWithdrawal({
          actorId: uid,
          accountId: liveId,
          amount: 100_000,
          payout: { method: "UPI", upiId: "me@okaxis" },
          destinationKey: "upi:me@okaxis",
        }),
        convertAccountCurrency({ actorId: uid, accountId: liveId, currency: "USD" }),
      ]);
      const account = await prisma.account.findUniqueOrThrow({ where: { id: liveId } });
      const rows = await prisma.withdrawal.findMany({ where: { userId: uid } });
      // Every in-flight row must be denominated in the account's current currency.
      for (const r of rows) expect(r.currency).toBe(account.currency);
      // Both succeeding would leave a withdrawal in the old currency on a converted account.
      if (w.status === "fulfilled" && c.status === "fulfilled") {
        expect(account.currency).toBe(w.value.currency);
      }
      // Whatever lost must have been refused cleanly (not crashed).
      for (const r of [w, c]) {
        if (r.status === "rejected") {
          expect(
            r.reason instanceof CurrencyChangeRefused || r.reason instanceof WithdrawalRefused,
          ).toBe(true);
        }
      }
      // Reset for the next round: clear rows, restore INR + a funded balance.
      await prisma.withdrawal.deleteMany({ where: { userId: uid } });
      await prisma.account.update({
        where: { id: liveId },
        data: { currency: "INR", realBalance: 5_000_000 },
      });
    }
  });
});

describe("convertAccountCurrency with open positions", () => {
  // Settlement and CFD close credit `trade.stake` (+ pnl) read before they
  // write; if the account were converted underneath an OPEN position the credit
  // would land in the old currency's units (100x). So no OPEN trade may exist at
  // switch time, and opening one must serialise against the switch.
  let uid = "";
  let liveId = "";
  let demoId = "";
  let assetId = "";

  beforeAll(async () => {
    const a = await prisma.asset.create({
      data: { symbol: `CONVPOS_${randomUUID().slice(0, 8)}`, displayName: "conv", kind: "OTC", basePrice: 1 },
    });
    assetId = a.id;
  });

  afterAll(async () => {
    await prisma.asset.delete({ where: { id: assetId } });
  });

  beforeEach(async () => {
    const u = await prisma.user.create({
      data: { email: `openpos-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    uid = u.id;
    const accounts = await createAccountsForUser(uid, 100_000_000, "INR");
    liveId = accounts.find((x) => x.type === "LIVE")!.id;
    demoId = accounts.find((x) => x.type === "DEMO")!.id;
    await prisma.account.update({ where: { id: liveId }, data: { realBalance: 5_000_000 } });
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: uid } });
  });

  const trade = (
    accountId: string,
    status: "OPEN" | "WON" | "LOST" | "REFUNDED" | "CLOSED",
    cfd = false,
  ) =>
    prisma.trade.create({
      data: {
        accountId,
        assetId,
        direction: "UP",
        stake: 100_000,
        payoutPct: cfd ? 0 : 92,
        entryPrice: 1,
        entryTs: new Date(),
        expiryTs: new Date(Date.now() + 60_000),
        status,
        ...(cfd ? { durationSec: 60, leverage: 100 } : {}),
      },
    });

  it.each([
    ["binary trade", false],
    ["CFD position", true],
  ] as const)("refuses to switch while a %s is OPEN", async (_label, cfd) => {
    await trade(liveId, "OPEN", cfd);
    const err = await convertAccountCurrency({ actorId: uid, accountId: liveId, currency: "USD" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CurrencyChangeRefused);
    expect((err as CurrencyChangeRefused).message).toBe("Close your open trades first.");
    expect((err as CurrencyChangeRefused).code).toBe("open_positions");
    const after = await prisma.account.findUniqueOrThrow({ where: { id: liveId } });
    expect(after.currency).toBe("INR");
    expect(after.realBalance).toBe(5_000_000);
    const row = await prisma.trade.findFirstOrThrow({ where: { accountId: liveId } });
    expect(row.stake).toBe(100_000);
  });

  it("refuses on a DEMO account too (open demo positions settle the same way)", async () => {
    await trade(demoId, "OPEN");
    const err = await convertAccountCurrency({ actorId: uid, accountId: demoId, currency: "USD" }).catch(
      (e: unknown) => e,
    );
    expect((err as CurrencyChangeRefused).code).toBe("open_positions");
  });

  it("allows the switch when every trade is settled, and ignores other accounts' open trades", async () => {
    await trade(liveId, "WON");
    await trade(liveId, "LOST");
    await trade(liveId, "REFUNDED");
    await trade(liveId, "CLOSED", true);
    await trade(demoId, "OPEN"); // the DEMO account's open trade does not block LIVE
    const updated = await convertAccountCurrency({ actorId: uid, accountId: liveId, currency: "USD" });
    expect(updated.currency).toBe("USD");
  });

  it("opening a binary trade racing a switch never leaves an OPEN trade in the wrong units", async () => {
    for (let i = 0; i < 6; i++) {
      const [o, c] = await Promise.allSettled([
        openTrade({
          accountId: liveId,
          assetId,
          direction: "UP",
          stake: 100_000,
          payoutPct: 92,
          entryPrice: 1,
          entryTs: new Date(),
          expiryTs: new Date(Date.now() + 60_000),
        }),
        convertAccountCurrency({ actorId: uid, accountId: liveId, currency: "USD" }),
      ]);
      const account = await prisma.account.findUniqueOrThrow({ where: { id: liveId } });
      const open = await prisma.trade.findMany({ where: { accountId: liveId, status: "OPEN" } });
      if (account.currency === "USD") {
        // Switched: any trade that opened must have been refused (or never exist).
        expect(open).toHaveLength(0);
        expect(c.status).toBe("fulfilled");
      } else {
        expect(c.status).toBe("rejected");
        expect((c as PromiseRejectedResult).reason).toBeInstanceOf(CurrencyChangeRefused);
        expect(o.status).toBe("fulfilled");
      }
      await prisma.trade.deleteMany({ where: { accountId: liveId } });
      await prisma.account.update({ where: { id: liveId }, data: { currency: "INR", realBalance: 5_000_000 } });
    }
  });

  it("a trade open that is retried across a switch is refused instead of debiting old units as new", async () => {
    // Hold the account row inside a transaction that converts it, then let
    // openTrade read the (still INR) row and block on its debit. When the
    // switch commits, openTrade's version check fails and it retries against
    // the USD account — with a stake the client still expressed in paise.
    const hold = prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: liveId },
        data: { currency: "USD", realBalance: 50_000, version: { increment: 1 } },
      });
      await new Promise((r) => setTimeout(r, 600));
    });
    await new Promise((r) => setTimeout(r, 150));
    const opened = openTrade({
      accountId: liveId,
      assetId,
      direction: "UP",
      stake: 10_000, // ₹100 as the INR client sent it
      payoutPct: 92,
      entryPrice: 1,
      entryTs: new Date(),
      expiryTs: new Date(Date.now() + 60_000),
    });
    await hold;
    await expect(opened).rejects.toBeInstanceOf(ConcurrentModification);
    expect(await prisma.trade.count({ where: { accountId: liveId } })).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: liveId } })).realBalance).toBe(50_000);
  });
});

describe("convertAccountCurrency over many trades", () => {
  it("converts thousands of trade rows in one statement, rounding like convertMinorBetween", async () => {
    const u = await prisma.user.create({
      data: { email: `manytrades-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    const a = await prisma.asset.create({
      data: { symbol: `CONVMANY_${randomUUID().slice(0, 8)}`, displayName: "conv", kind: "OTC", basePrice: 1 },
    });
    const accounts = await createAccountsForUser(u.id, 0, "INR");
    const liveId = accounts.find((x) => x.type === "LIVE")!.id;
    const base = {
      accountId: liveId,
      assetId: a.id,
      direction: "UP" as const,
      payoutPct: 92,
      entryPrice: 1,
      entryTs: new Date(),
      expiryTs: new Date(),
      status: "LOST" as const,
    };
    const edge = [
      { stake: 150, pnl: -150, spreadFee: 150, peakPnl: 150 }, // ±1.5 -> 2 / -1 (Math.round)
      { stake: 149, pnl: -149, spreadFee: 149, peakPnl: null },
      { stake: 151, pnl: -151, spreadFee: 51, peakPnl: 0 },
      { stake: 50, pnl: -50, spreadFee: 50, peakPnl: -50 }, // -0.5 -> 0
    ];
    await prisma.trade.createMany({
      data: [
        ...edge.map((e) => ({ ...base, ...e, stakeFromBonus: 50 })),
        ...Array.from({ length: 6_000 }, () => ({ ...base, stake: 100_000, pnl: -100_000, stakeFromBonus: 0 })),
      ],
    });

    const started = Date.now();
    await convertAccountCurrency({ actorId: u.id, accountId: liveId, currency: "USD" });
    expect(Date.now() - started).toBeLessThan(4_000);

    const rows = await prisma.trade.findMany({ where: { accountId: liveId, stake: { lt: 1_000 } } });
    const mine = rows.filter((r) => r.stake <= 2);
    expect(mine).toHaveLength(4);
    for (const e of edge) {
      const want = {
        stake: convertMinorBetween(e.stake, "INR", "USD"),
        pnl: convertMinorBetween(e.pnl, "INR", "USD"),
        spreadFee: convertMinorBetween(e.spreadFee, "INR", "USD"),
      };
      const got = mine.find((r) => r.stake === want.stake && r.spreadFee === want.spreadFee && r.pnl === want.pnl);
      expect(got, JSON.stringify({ e, want })).toBeDefined();
    }
    const big = await prisma.trade.findFirstOrThrow({ where: { accountId: liveId, stake: 1_000 } });
    expect(big.pnl).toBe(-1_000);
    expect(await prisma.trade.count({ where: { accountId: liveId, stake: 1_000 } })).toBe(6_000);
    const peaks = await prisma.trade.findMany({ where: { accountId: liveId, spreadFee: 2 }, select: { peakPnl: true } });
    expect(peaks[0]?.peakPnl).toBe(2); // 150 -> 2

    // And back: USD -> INR is exact multiplication.
    await convertAccountCurrency({ actorId: u.id, accountId: liveId, currency: "INR" });
    expect(await prisma.trade.count({ where: { accountId: liveId, stake: 100_000 } })).toBe(6_000);

    await prisma.user.delete({ where: { id: u.id } });
    await prisma.asset.delete({ where: { id: a.id } });
  }, 60_000);
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
