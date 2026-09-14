import { prisma } from "../client";
import type { SupportTicket } from "../../generated/prisma/client";

export async function createTicket(
  actorId: string,
  input: { subject: string; body: string },
): Promise<SupportTicket> {
  return prisma.supportTicket.create({
    data: { userId: actorId, subject: input.subject, body: input.body },
  });
}

/** Ownership is in the predicate. */
export async function listTicketsForActor(actorId: string, limit: number): Promise<SupportTicket[]> {
  return prisma.supportTicket.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
}
