import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PageFrame } from "@/components/shell/PageFrame";
import { HistoryList } from "@/components/history/HistoryList";
import { loadPaymentRows } from "@/components/history/load-payment-rows";

export const dynamic = "force-dynamic";

/**
 * Everything that happened on the account in one feed: closed trades (from the
 * active account in the platform context) plus deposits and withdrawals (read
 * here). `?filter=` picks a tab and `?tx=d:<id>` / `w:<id>` opens a detail sheet.
 */
export default async function HistoryPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const payments = await loadPaymentRows(session.userId, 100);

  return (
    <PageFrame width="narrow" title="History">
      <HistoryList payments={payments} includeTrades />
    </PageFrame>
  );
}
