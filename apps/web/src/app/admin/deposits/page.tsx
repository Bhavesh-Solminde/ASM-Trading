import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listOrphanBankCredits, listPendingDeposits, prisma } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { approveDepositAction, rejectDepositAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminDepositsPage() {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");

  const [deposits, orphans, pending] = await Promise.all([
    prisma.deposit.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    listOrphanBankCredits(100),
    listPendingDeposits(50),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Deposits</h1>
        <a
          href="/admin/messages"
          className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
        >
          ← Messages
        </a>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Create test deposit
        </h2>
        <form
          className="flex flex-wrap gap-2"
          action="/api/admin/deposits"
          method="post"
          encType="application/json"
        >
          <input
            name="userId"
            placeholder="userId"
            required
            className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-3 py-2 text-sm"
          />
          <input
            name="amountUsdMinor"
            type="number"
            placeholder="Amount (USD cents)"
            required
            className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white"
          >
            Create
          </button>
        </form>
        <p className="text-xs text-[var(--color-ink-2)]">
          Note: this form posts JSON via the browser's native form encoding, which
          sends form-urlencoded, not JSON — for a real test, use curl or the
          browser devtools console to POST JSON directly to /api/admin/deposits,
          e.g.: <code>fetch(&quot;/api/admin/deposits&quot;, {'{'} method: &quot;POST&quot;, headers: {'{'}
          &quot;Content-Type&quot;: &quot;application/json&quot; {'}'}, body: JSON.stringify({'{'}
          userId, amountUsdMinor {'}'}) {'}'})</code>.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Pending claims awaiting review ({pending.length})
        </h2>
        <p className="text-xs text-[var(--color-ink-2)]">
          Only the residue reaches here — exact and amount-only matches approve
          automatically. Approving credits the balance with no bank credit on
          record (an out-of-band vouch); the money split and 50% bonus are the
          same as an automatic match.
        </p>
        {pending.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-2)]">Nothing awaiting review.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3 text-sm"
              >
                <span className="font-semibold">{d.method}</span>
                <span className="tabular-nums">₹{(d.amountInr / 100).toFixed(2)}</span>
                <span className="tabular-nums text-[var(--color-ink-2)]">
                  ${(d.amountUsd / 100).toFixed(2)}
                </span>
                <span className="font-mono text-xs text-[var(--color-ink-2)]">
                  {d.claimedUtr ?? "no reference"}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-ink-2)]">{d.id}</span>
                <div className="ml-auto flex gap-2">
                  <form action={approveDepositAction}>
                    <input type="hidden" name="depositId" value={d.id} />
                    <button
                      type="submit"
                      className="rounded-md bg-[var(--color-up)] px-3 py-1.5 text-xs font-bold text-[#06231a]"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={rejectDepositAction}>
                    <input type="hidden" name="depositId" value={d.id} />
                    <input type="hidden" name="reason" value="no matching credit found" />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-down)] px-3 py-1.5 text-xs font-bold text-[var(--color-down)]"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Orphaned credits (need manual matching)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-edge)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-panel)] text-[var(--color-ink-2)]">
              <tr>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">UTR</th>
                <th className="px-3 py-2">Credit ID</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((c) => (
                <tr key={c.id} className="border-t border-[var(--color-edge)]">
                  <td className="px-3 py-2 whitespace-nowrap">{c.receivedAt.toISOString()}</td>
                  <td className="px-3 py-2 tabular-nums">{(c.amountInr / 100).toFixed(2)}</td>
                  <td className="px-3 py-2">{c.utr}</td>
                  <td className="px-3 py-2 font-mono">{c.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orphans.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-2)]">No orphaned credits.</p>
        ) : (
          <p className="text-xs text-[var(--color-ink-2)]">
            To manually match, POST {'{'} depositId, creditId {'}'} to
            /api/admin/deposits/match with the depositId from the table below.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Recent deposits
        </h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-edge)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-panel)] text-[var(--color-ink-2)]">
              <tr>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Reserved amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Deposit ID</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id} className="border-t border-[var(--color-edge)]">
                  <td className="px-3 py-2 whitespace-nowrap">{d.createdAt.toISOString()}</td>
                  <td className="px-3 py-2 font-mono">{d.userId}</td>
                  <td className="px-3 py-2 tabular-nums">{(d.amountInr / 100).toFixed(2)}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2 font-mono">{d.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
