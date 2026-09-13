import { prisma } from "../client";
import type { RelayMessage } from "../../generated/prisma/client";

export async function createRelayMessage(input: {
  source: string;
  deviceLabel: string | null;
  deviceModel: string | null;
  sender: string | null;
  body: string;
  receivedAt: Date;
  parsedAmountInr: number | null;
  parsedUtr: string | null;
  isCredit: boolean | null;
}): Promise<RelayMessage> {
  return prisma.relayMessage.create({ data: input });
}

export async function linkRelayMessageToCredit(
  relayMessageId: string,
  bankCreditId: string,
): Promise<void> {
  await prisma.relayMessage.update({
    where: { id: relayMessageId },
    data: { bankCreditId },
  });
}

export async function listRelayMessages(
  filter: { source?: string; deviceLabel?: string },
  limit: number,
): Promise<RelayMessage[]> {
  return prisma.relayMessage.findMany({
    where: {
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.deviceLabel ? { deviceLabel: filter.deviceLabel } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
