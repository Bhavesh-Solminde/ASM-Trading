import { depositCreditMinor, listAccountsForActor, listDepositsForActor, listWithdrawalsForActor } from "@asm/db";
import type { PaymentRow } from "./history-model";
import { depositRow, withdrawalRow } from "./payment-rows";

/**
 * SERVER ONLY (reads the database). Loads a user's deposits and withdrawals as
 * serialisable rows for the History list: newest first, merged and capped at
 * `limit` rows in total (up to `limit` of each kind are fetched, then the merged
 * list is cut). `before` pages by creation time.
 *
 * Deposit amounts are shown in the user's LIVE account currency, the same
 * figure that was (or will be) credited, via `depositCreditMinor`. If that
 * can't be derived (e.g. a legacy account currency) it falls back to the
 * deposit's own USD value instead of hiding the row.
 */
export async function loadPaymentRows(userId: string, limit = 50, before?: Date): Promise<PaymentRow[]> {
  const [deposits, withdrawals, accounts] = await Promise.all([
    listDepositsForActor(userId, limit, before),
    listWithdrawalsForActor(userId, limit, before),
    listAccountsForActor(userId),
  ]);
  const liveCurrency = accounts.find((a) => a.type === "LIVE")?.currency ?? "INR";

  const rows: PaymentRow[] = [
    ...deposits.map((d) => {
      try {
        return depositRow(d, depositCreditMinor(d, liveCurrency), liveCurrency);
      } catch {
        const usd = d.method === "USDT" ? (d.amountUsdtMinor ?? 0) : d.amountUsd;
        return depositRow(d, usd, "USD");
      }
    }),
    ...withdrawals.map((w) => withdrawalRow(w)),
  ];
  return rows
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
