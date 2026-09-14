import { prisma } from "../client";

/**
 * Ensures N bot users exist with a DEMO account. Idempotent: existing bots
 * are returned unchanged. Bots have isBot=true so the login route rejects them.
 */
export async function provisionBots(
  count: number,
  demoBalance: number,
  prefix = "bot",
): Promise<{ userId: string; accountId: string }[]> {
  const results: { userId: string; accountId: string }[] = [];

  for (let i = 0; i < count; i++) {
    const email = `${prefix}-${String(i).padStart(4, "0")}@bots.internal`;

    const user = await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash: "__BOT__", isBot: true },
      update: {},
    });

    const existing = await prisma.account.findFirst({
      where: { userId: user.id, type: "DEMO" },
    });

    let account;
    if (existing) {
      account = existing;
    } else {
      account = await prisma.account.create({
        data: {
          userId: user.id,
          type: "DEMO",
          realBalance: demoBalance,
        },
      });
    }

    results.push({ userId: user.id, accountId: account.id });
  }

  return results;
}

/**
 * Tops up a bot's demo balance — recorded as a DEMO_RESET transaction for
 * audit purposes so bot activity never contaminates real trade reconciliation.
 */
export async function resetDemoBalance(
  accountId: string,
  target: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { realBalance: true },
    });

    const top = Math.max(0, target - account.realBalance);
    if (top === 0) return;

    await tx.account.update({
      where: { id: accountId },
      data: { realBalance: { increment: top } },
    });

    await tx.transaction.create({
      data: {
        accountId,
        kind: "DEMO_RESET",
        amount: top,
        balanceAfter: target,
        refType: "Bot",
        refId: accountId,
      },
    });
  });
}
