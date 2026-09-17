import { prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminShell } from "../_components/AdminShell";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  const [pendingDeposits, requestedWithdrawals] = await Promise.all([
    prisma.deposit.count({ where: { status: "PENDING_CONFIRMATION" } }),
    prisma.withdrawal.count({ where: { status: "REQUESTED" } }),
  ]);

  return (
    <AdminShell badges={{ approvals: pendingDeposits + requestedWithdrawals }}>
      {children}
    </AdminShell>
  );
}
