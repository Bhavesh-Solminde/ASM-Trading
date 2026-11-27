import { prisma, type DbTransaction } from "../client";

/** Whether clients must pass KYC before withdrawing. No row yet means KYC is required. */
export async function isKycRequired(client: Pick<DbTransaction, "platformSettings"> = prisma): Promise<boolean> {
  const row = await client.platformSettings.findUnique({ where: { id: 1 }, select: { kycRequired: true } });
  return row?.kycRequired ?? true;
}

/** Locks the singleton so concurrent requests audit each change once. */
export async function setKycRequired(kycRequired: boolean, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "PlatformSettings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING`;
    const [row] = await tx.$queryRaw<{ kycRequired: boolean }[]>`SELECT "kycRequired" FROM "PlatformSettings" WHERE "id" = 1 FOR UPDATE`;
    const before = row?.kycRequired ?? true;
    if (before === kycRequired) return;

    await tx.platformSettings.update({ where: { id: 1 }, data: { kycRequired } });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "platform.kyc_requirement_changed",
        targetType: "PlatformSettings",
        targetId: "1",
        before: { kycRequired: before },
        after: { kycRequired },
      },
    });
  });
}
