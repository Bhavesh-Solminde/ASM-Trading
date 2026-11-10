import { prisma, type DbClient } from "../client";
import type { Account, User } from "../models";

/** One-time starting balance for each new affiliate account, in paise. */
export const AFFILIATE_START_BALANCE_MINOR = 10_000_00;
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
 * one-time ₹10,000 starting balance in one transaction. The user is created with:
 *   - role         = AFFILIATE
 *   - emailVerified = true  (no email challenge for a staff-created account)
 *   - liveAccess   = true   (the LIVE account must work without the global gate)
 *   - kycStatus    = NOT_STARTED (and never prompted — withdrawals never fire)
 *
 * Also writes two `AFFILIATE_RESET` ledger rows (one per account) so the
 * starting balance is visible in transaction history, and an AuditLog entry
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

    const live = await tx.account.create({
      data: {
        userId: user.id,
        type: "LIVE",
        currency: AFFILIATE_CURRENCY,
        realBalance: AFFILIATE_START_BALANCE_MINOR,
      },
    });
    const demo = await tx.account.create({
      data: {
        userId: user.id,
        type: "DEMO",
        currency: AFFILIATE_CURRENCY,
        realBalance: AFFILIATE_START_BALANCE_MINOR,
      },
    });

    for (const account of [live, demo]) {
      await tx.transaction.create({
        data: {
          accountId: account.id,
          kind: "AFFILIATE_RESET",
          amount: AFFILIATE_START_BALANCE_MINOR,
          balanceAfter: AFFILIATE_START_BALANCE_MINOR,
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
  accounts: { id: string; type: "LIVE" | "DEMO"; currency: string; realBalance: number; bonusBalance: number }[];
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
          id: true,
          currency: true,
          bonusBalance: true,
        },
      },
    },
  });
  return rows.map((row) => {
    return {
      id: row.id,
      email: row.email,
      nickname: row.nickname,
      createdAt: row.createdAt,
      accounts: row.accounts,
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

/** Admin-only caller sets the available balance. Open contract stakes stay locked. */
export async function setAffiliateAccountBalance(input: {
  accountId: string;
  currency: string;
  balanceMinor: number;
  requestId: string;
}, client: DbClient = prisma): Promise<void> {
  if (!Number.isSafeInteger(input.balanceMinor) || input.balanceMinor < 0
    || !["INR", "USD"].includes(input.currency)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) {
    throw new AffiliateCreationRefused("Enter a valid balance with up to two decimal places.");
  }
  await client.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${input.accountId} FOR NO KEY UPDATE`;
    const account = await tx.account.findUnique({
      where: { id: input.accountId },
      include: { user: { select: { role: true } } },
    });
    if (!account || account.user.role !== "AFFILIATE") {
      throw new AffiliateCreationRefused("Affiliate account not found.");
    }
    const prior = await tx.transaction.findUnique({ where: { id: input.requestId } });
    if (prior) {
      if (prior.accountId !== account.id || prior.refType !== "AffiliateBalanceSet"
        || prior.refId !== input.currency || prior.balanceAfter !== input.balanceMinor) {
        throw new AffiliateCreationRefused("This balance update has already been used. Refresh and try again.");
      }
      return;
    }
    if (account.currency !== input.currency) {
      throw new AffiliateCreationRefused("The account currency changed. Refresh and enter the balance again.");
    }
    const delta = input.balanceMinor - account.realBalance - account.bonusBalance;
    await tx.account.update({
      where: { id: account.id },
      data: { realBalance: input.balanceMinor, bonusBalance: 0, version: { increment: 1 } },
    });
    await tx.transaction.create({ data: {
      id: input.requestId, accountId: account.id, kind: "AFFILIATE_RESET",
      amount: delta, balanceAfter: input.balanceMinor, refType: "AffiliateBalanceSet", refId: input.currency,
    } });
    await tx.auditLog.create({ data: {
      actorId: ADMIN_AUDIT_ACTOR, action: "affiliate.balance_set", targetType: "Account", targetId: account.id,
      before: { currency: account.currency, realBalance: account.realBalance, bonusBalance: account.bonusBalance },
      after: { currency: account.currency, realBalance: input.balanceMinor, bonusBalance: 0, requestId: input.requestId },
    } });
  });
}
