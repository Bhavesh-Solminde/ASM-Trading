import { prisma } from "../client";
import type { Account, User } from "../../generated/prisma/client";

/**
 * Daily play float for an affiliate account, in paise. ₹10,000 — set via
 * the admin "Create affiliate" flow and reset to this value at 00:00 IST
 * every day. Applied identically to the LIVE and the DEMO account so a
 * streamer flipping the account switcher never shows a tell about which
 * side is which.
 *
 * See docs/superpowers/specs/2026-10-08-affiliate-accounts-design.md.
 */
export const AFFILIATE_DAILY_FLOAT_MINOR = 10_000_00;

/** Default currency for an affiliate account. Fixed — the admin flow does not
 *  expose a currency picker, and the daily float constant is denominated in
 *  paise. */
export const AFFILIATE_CURRENCY = "INR";

const ADMIN_AUDIT_ACTOR = "admin-panel";

export class AffiliateCreationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AffiliateCreationRefused";
  }
}

/**
 * Creates an affiliate user and both of their accounts (LIVE + DEMO) at the
 * ₹10,000 float in one transaction. The user is created with:
 *   - role         = AFFILIATE
 *   - emailVerified = true  (no email challenge for a staff-created account)
 *   - liveAccess   = true   (the LIVE account must work without the global gate)
 *   - kycStatus    = NOT_STARTED (and never prompted — withdrawals never fire)
 *
 * Also writes two `AFFILIATE_RESET` ledger rows (one per account) so the
 * starting float is visible in transaction history, and an AuditLog entry
 * attributing the creation to the admin.
 *
 * `passwordHash` is supplied by the caller (the admin action, which already
 * owns the password hashing). This keeps argon2 out of the db package.
 *
 * Throws `AffiliateCreationRefused` on a duplicate email.
 */
export async function createAffiliate(input: {
  email: string;
  passwordHash: string;
  nickname?: string | null;
}): Promise<{ user: User; accounts: Account[] }> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new AffiliateCreationRefused("Enter a valid email address.");
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    throw new AffiliateCreationRefused("That email is already registered.");
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash: input.passwordHash,
        role: "AFFILIATE",
        emailVerified: true,
        liveAccess: true,
        kycStatus: "NOT_STARTED",
        status: "ACTIVE",
        nickname: input.nickname?.trim() || null,
      },
    });

    const now = new Date();
    const live = await tx.account.create({
      data: {
        userId: user.id,
        type: "LIVE",
        currency: AFFILIATE_CURRENCY,
        realBalance: AFFILIATE_DAILY_FLOAT_MINOR,
        lastAffiliateResetAt: now,
      },
    });
    const demo = await tx.account.create({
      data: {
        userId: user.id,
        type: "DEMO",
        currency: AFFILIATE_CURRENCY,
        realBalance: AFFILIATE_DAILY_FLOAT_MINOR,
        lastAffiliateResetAt: now,
      },
    });

    for (const account of [live, demo]) {
      await tx.transaction.create({
        data: {
          accountId: account.id,
          kind: "AFFILIATE_RESET",
          amount: AFFILIATE_DAILY_FLOAT_MINOR,
          balanceAfter: AFFILIATE_DAILY_FLOAT_MINOR,
          refType: "AffiliateCreated",
          refId: user.id,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: ADMIN_AUDIT_ACTOR,
        action: "affiliate.created",
        targetType: "User",
        targetId: user.id,
        after: { email, role: "AFFILIATE" },
      },
    });

    return { user, accounts: [live, demo] };
  });
}

export interface AffiliateListItem {
  id: string;
  email: string;
  nickname: string | null;
  createdAt: Date;
  liveBalance: number;
  demoBalance: number;
  lastResetAt: Date | null;
}

/** Every affiliate, newest first, with their LIVE and DEMO balances. */
export async function listAffiliates(): Promise<AffiliateListItem[]> {
  const rows = await prisma.user.findMany({
    where: { role: "AFFILIATE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      nickname: true,
      createdAt: true,
      accounts: {
        select: {
          type: true,
          realBalance: true,
          lastAffiliateResetAt: true,
        },
      },
    },
  });
  return rows.map((row) => {
    const live = row.accounts.find((a) => a.type === "LIVE");
    const demo = row.accounts.find((a) => a.type === "DEMO");
    const lastResetAt =
      live?.lastAffiliateResetAt ?? demo?.lastAffiliateResetAt ?? null;
    return {
      id: row.id,
      email: row.email,
      nickname: row.nickname,
      createdAt: row.createdAt,
      liveBalance: live?.realBalance ?? 0,
      demoBalance: demo?.realBalance ?? 0,
      lastResetAt,
    };
  });
}

/** Overwrites an affiliate's passwordHash. The caller (the admin action)
 *  owns the argon2 hashing — the db package stays password-library-agnostic.
 *  Refuses on a non-affiliate user so this never becomes a general password
 *  reset path for regular users or admins. */
export async function resetAffiliatePasswordById(input: {
  userId: string;
  passwordHash: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { role: true, email: true },
  });
  if (!user) {
    throw new AffiliateCreationRefused("Affiliate not found.");
  }
  if (user.role !== "AFFILIATE") {
    throw new AffiliateCreationRefused(
      "This user is not an affiliate — password changes for regular users go through the user flow.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { passwordHash: input.passwordHash },
    });
    await tx.auditLog.create({
      data: {
        actorId: ADMIN_AUDIT_ACTOR,
        action: "affiliate.password_reset",
        targetType: "User",
        targetId: input.userId,
        after: { email: user.email },
      },
    });
  });
}

/** Permanently removes an affiliate and (via cascade) their accounts, trades
 *  and ledger. Refuses to touch a user who is not an affiliate — the admin
 *  users surface is for everything else. */
export async function deleteAffiliateById(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  });
  if (!user) return;
  if (user.role !== "AFFILIATE") {
    throw new AffiliateCreationRefused(
      "This user is not an affiliate — delete from the Users panel instead.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id: userId } });
    await tx.auditLog.create({
      data: {
        actorId: ADMIN_AUDIT_ACTOR,
        action: "affiliate.deleted",
        targetType: "User",
        targetId: userId,
        before: { email: user.email, role: "AFFILIATE" },
      },
    });
  });
}

/**
 * Resets one affiliate account's balance to the daily float. Idempotent on
 * the IST calendar day: a second call within the same IST day is a no-op.
 * Returns true when the row was actually reset, false when the guard skipped
 * it.
 *
 * The daily-reset engine job calls this once per affiliate account per IST
 * day; `createAffiliate` seeds `lastAffiliateResetAt = now()` so an
 * account created mid-day is NOT reset again that same day.
 */
export async function resetAffiliateAccountFloat(input: {
  accountId: string;
  nowIstDate: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({
      where: { id: input.accountId },
      select: {
        id: true,
        realBalance: true,
        bonusBalance: true,
        lastAffiliateResetAt: true,
      },
    });
    if (!account) return false;
    if (
      account.lastAffiliateResetAt !== null &&
      istDateOf(account.lastAffiliateResetAt) === input.nowIstDate
    ) {
      return false;
    }
    const delta = AFFILIATE_DAILY_FLOAT_MINOR - account.realBalance;
    await tx.account.update({
      where: { id: account.id },
      data: {
        realBalance: AFFILIATE_DAILY_FLOAT_MINOR,
        bonusBalance: 0,
        lastAffiliateResetAt: new Date(),
        version: { increment: 1 },
      },
    });
    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "AFFILIATE_RESET",
        amount: delta,
        balanceAfter: AFFILIATE_DAILY_FLOAT_MINOR,
        refType: "DailyReset",
        refId: account.id,
      },
    });
    return true;
  });
}

/** IDs of every affiliate account whose last reset is on a different IST
 *  calendar date from `nowIstDate`, or has never been reset. The job iterates
 *  this list and calls `resetAffiliateAccountFloat` for each — the per-row
 *  check inside that function closes the race with a concurrent restart. */
export async function listAffiliateAccountsNeedingReset(input: {
  nowIstDate: string;
}): Promise<string[]> {
  const rows = await prisma.account.findMany({
    where: {
      user: { role: "AFFILIATE" },
    },
    select: { id: true, lastAffiliateResetAt: true },
  });
  return rows
    .filter(
      (row) =>
        row.lastAffiliateResetAt === null ||
        istDateOf(row.lastAffiliateResetAt) !== input.nowIstDate,
    )
    .map((row) => row.id);
}

/** YYYY-MM-DD in Asia/Kolkata (IST = UTC+5:30). No DST; a fixed offset is
 *  exact. Shared by the reset guard above and the engine job that calls it. */
export function istDateOf(instant: Date): string {
  const istMs = instant.getTime() + 5.5 * 3_600_000;
  const d = new Date(istMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
