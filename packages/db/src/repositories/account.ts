import { prisma } from "../client.js";
import type { Account } from "../../generated/prisma/client.js";

/**
 * Ownership is expressed in the query predicate, never as a check after the
 * fetch. A caller cannot forget it because `actorId` is a required parameter —
 * this is what closes broken-object-level-authorisation by construction.
 */

export async function listAccountsForActor(actorId: string): Promise<Account[]> {
  return prisma.account.findMany({
    where: { userId: actorId },
    orderBy: { type: "asc" },
  });
}

export async function getAccountForActor(
  actorId: string,
  accountId: string,
): Promise<Account | null> {
  return prisma.account.findFirst({
    where: { id: accountId, userId: actorId },
  });
}

/** Every user gets exactly one LIVE account at zero and one funded DEMO account. */
export async function createAccountsForUser(
  userId: string,
  demoBalanceMinor: number,
): Promise<Account[]> {
  return prisma.$transaction([
    prisma.account.create({
      data: { userId, type: "LIVE", realBalance: 0 },
    }),
    prisma.account.create({
      data: { userId, type: "DEMO", realBalance: demoBalanceMinor },
    }),
  ]);
}
