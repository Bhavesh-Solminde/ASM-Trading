/**
 * Dev/admin one-shot. Grants a named user LIVE access, ensures their LIVE
 * account exists, and zeros its balances. Idempotent — re-runs are a no-op
 * on already-live users beyond the balance reset. Run with EMAIL="…" set.
 */
import { prisma } from "../src/client";
import { createAccountsForUser } from "../src/repositories/account";

const email = process.env.EMAIL;
if (!email) {
  console.error("Set EMAIL=<address> to pick the user.");
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  console.error(`No user with email ${email}. Nothing changed.`);
  process.exit(1);
}

await prisma.user.update({
  where: { id: user.id },
  data: { liveAccess: true, emailVerified: true, status: "ACTIVE" },
});

try {
  // Creates DEMO + LIVE if missing; harmless when they already exist.
  await createAccountsForUser(user.id, 10_000_000);
} catch {
  /* both accounts already exist */
}

await prisma.account.updateMany({
  where: { userId: user.id, type: "LIVE" },
  data: { realBalance: 0, bonusBalance: 0 },
});

const live = await prisma.account.findFirst({
  where: { userId: user.id, type: "LIVE" },
  select: { id: true, realBalance: true, bonusBalance: true, currency: true },
});

console.log(`Granted LIVE access to ${email}. Live account:`, live);
await prisma.$disconnect();
