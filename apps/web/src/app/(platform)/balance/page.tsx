import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, listDepositsForActor, listWithdrawalsForActor } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PlatformTabs } from "@/components/shell/PlatformTabs";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PENDING_CONFIRMATION: "Processing",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  REQUESTED: "Waiting confirmation",
  APPROVED: "Approved",
  PAID: "Paid",
};

export default async function BalancePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [deposits, withdrawals] = await Promise.all([
    listDepositsForActor(session.userId, 50),
    listWithdrawalsForActor(session.userId, 50),
  ]);

  const rows = [
    ...deposits.map((d) => ({
      id: d.id,
      at: d.createdAt,
      status: d.status,
      kind: "Deposit" as const,
      method: d.method,
      amount: d.amountUsd,
      note:
        d.status === "PENDING_CONFIRMATION"
          ? "Payments with this method can take up to 48 hours. The status may appear as “Failed” until the funds are received on our side."
          : null,
    })),
    ...withdrawals.map((w) => ({
      id: w.id,
      at: w.createdAt,
      status: w.status,
      kind: "Withdrawal" as const,
      method: w.method,
      amount: -w.amount,
      note: null,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8 phone:px-4 phone:py-5">
      <PlatformTabs />
      <h1 className="text-lg font-bold tracking-tight">History</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">No transactions yet.</p>
      ) : (
        <>
          <ul className="hidden flex-col phone:flex">
            {rows.map((row) => {
              const isDeposit = row.kind === "Deposit";
              return (
                <li
                  key={row.id}
                  className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 border-t border-[var(--color-rule)] py-3 text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                        isDeposit
                          ? "bg-up/15 text-up border border-up/25"
                          : "bg-down/15 text-down border border-down/25"
                      }`}
                    >
                      {isDeposit ? (
                        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M17 7L7 17M7 17h8M7 17V9" />
                        </svg>
                      ) : (
                        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M7 17L17 7M17 7H9M17 7v8" />
                        </svg>
                      )}
                    </span>
                    <div className="flex flex-col">
                      <span className={`font-semibold ${isDeposit ? "text-up" : "text-down"}`}>
                        {row.kind}
                      </span>
                      <span className="text-xs text-ink-2">{row.method}</span>
                    </div>
                  </div>
                  <span
                    className={`flex items-center justify-end gap-1 text-right font-semibold tabular-nums ${
                      isDeposit ? "text-up" : "text-down"
                    }`}
                  >
                    <span>{isDeposit ? "+" : "−"}</span>
                    <span>{formatMoney(Math.abs(row.amount), "USD")}</span>
                  </span>
                  <span className="text-xs tabular-nums text-[var(--color-ink-2)]">
                    {row.at.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="text-right text-xs text-ink-2">{STATUS_LABEL[row.status] ?? row.status}</span>
                  <span className="col-span-2 font-mono text-[11px] text-[var(--color-ink-3)]">
                    {row.id.slice(0, 8).toUpperCase()}
                  </span>
                  {row.note ? (
                    <p className="col-span-2 mt-1 rounded bg-[var(--color-tile)] p-2 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                      {row.note}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="overflow-x-auto phone:hidden">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">
                  <th className="pb-2">Transaction ID</th>
                  <th className="pb-2">Date and time</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Payment system</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isDeposit = row.kind === "Deposit";
                  return (
                    <tr key={row.id} className="border-t border-[var(--color-rule)] align-top">
                      <td className="py-3 font-mono text-xs">{row.id.slice(0, 8).toUpperCase()}</td>
                      <td className="py-3 tabular-nums text-[var(--color-ink-2)]">
                        {row.at.toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="py-3">
                        <span className="flex items-center gap-1.5">
                          <span aria-hidden>🕐</span>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>
                        {row.note ? (
                          <p className="mt-2 max-w-sm rounded bg-[var(--color-tile)] p-2 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                            {row.note}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            isDeposit
                              ? "bg-up/15 text-up border border-up/25"
                              : "bg-down/15 text-down border border-down/25"
                          }`}
                        >
                          {isDeposit ? (
                            <svg className="size-3 text-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M17 7L7 17M7 17h8M7 17V9" />
                            </svg>
                          ) : (
                            <svg className="size-3 text-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M7 17L17 7M17 7H9M17 7v8" />
                            </svg>
                          )}
                          {row.kind}
                        </span>
                      </td>
                      <td className="py-3 text-ink-2">{row.method}</td>
                      <td
                        className={`py-3 text-right font-semibold tabular-nums ${
                          isDeposit ? "text-up" : "text-down"
                        }`}
                      >
                        {isDeposit ? "+" : "−"}
                        {formatMoney(Math.abs(row.amount), "USD")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
