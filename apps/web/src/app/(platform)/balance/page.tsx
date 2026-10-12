import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { PageFrame } from "@/components/shell/PageFrame";
import { HistoryList } from "@/components/history/HistoryList";
import { loadPaymentRows } from "@/components/history/load-payment-rows";

export const dynamic = "force-dynamic";

/**
 * Payments history: deposits and withdrawals only (the Payments tab strip's
 * "History" tab). The full feed, with trades, lives at /history. Rows open the
 * same detail sheet, so the status tracker is one tap away from here too.
 */
export default async function BalancePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const payments = await loadPaymentRows(session.userId);

  return (
    <PageFrame width="narrow" nav={<PlatformTabs />} title="History">
      <div className="w-full max-w-2xl">
        <HistoryList payments={payments} includeTrades={false} />
      </div>
    </PageFrame>
  );
}
