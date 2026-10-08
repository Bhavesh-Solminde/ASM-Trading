import { countOpenReconciliationIssues, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminShell } from "../_components/AdminShell";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  // Affiliate deposits and withdrawals never need admin action — exclude
  // them from the sidebar-badge counts so the badge reflects real work.
  const [pendingDeposits, requestedWithdrawals, openFlags, reconciliation] = await Promise.all([
    prisma.deposit.count({
      where: {
        status: "PENDING_CONFIRMATION",
        user: { role: { not: "AFFILIATE" } },
      },
    }),
    prisma.withdrawal.count({
      where: {
        status: "REQUESTED",
        user: { role: { not: "AFFILIATE" } },
      },
    }),
    prisma.fraudFlag.count({ where: { status: "OPEN" } }),
    countOpenReconciliationIssues(),
  ]);

  return (
    <AdminShell
      badges={{
        deposits: pendingDeposits,
        withdrawals: requestedWithdrawals,
        fraud: openFlags,
        // P1 only: a warning shouldn't carry the same nav urgency as an open
        // fraud flag or a pending deposit — it surfaces on the page itself.
        reconciliation: reconciliation.p1,
      }}
    >
      {children}
    </AdminShell>
  );
}
