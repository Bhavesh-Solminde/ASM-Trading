import { creditedMinorByDeposit, depositCreditMinor, listAccountsForActor, listDepositsForActor, listWithdrawalsForActor } from "@asm/db";
import type { PaymentRow } from "./history-model";
import { depositRow, withdrawalRow } from "./payment-rows";

/**
 * SERVER ONLY (reads the database). Loads a user's deposits and withdrawals as
 * serialisable rows for the History list: newest first, up to `limit` of each.
 *
 * Deposit amounts are shown in the user's LIVE account currency. A completed
 * deposit shows what the ledger says was credited (restated in the current
 * currency if the account switched since), so it never drifts when the rate
 * changes; a pending one shows what it will credit, via `depositCreditMinor`.
 * If neither can be derived (e.g. a legacy account currency) it falls back to
 * the deposit's own USD value instead of hiding the row.
 */
export async function loadPaymentRows(userId: string, limit = 50): Promise<PaymentRow[]> {
  const [deposits, withdrawals, accounts] = await Promise.all([
    listDepositsForActor(userId, limit),
    listWithdrawalsForActor(userId, limit),
    listAccountsForActor(userId),
  ]);
  const live = accounts.find((a) => a.type === "LIVE");
  const liveCurrency = live?.currency ?? "INR";
  const credited = live
    ? await creditedMinorByDeposit(live.id, deposits.filter((d) => d.status === "COMPLETED"), liveCurrency)
    : new Map<string, number>();

  const rows: PaymentRow[] = [
    ...deposits.map((d) => {
      try {
        return depositRow(d, credited.get(d.id) ?? depositCreditMinor(d, liveCurrency), liveCurrency);
      } catch {
        const usd = d.method === "USDT" ? (d.amountUsdtMinor ?? 0) : d.amountUsd;
        return depositRow(d, usd, "USD");
      }
    }),
    ...withdrawals.map((w) => withdrawalRow(w)),
  ];
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
