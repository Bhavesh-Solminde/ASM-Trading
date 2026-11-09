import { randomUUID } from "node:crypto";
import Link from "next/link";
import { formatMoney, listAffiliates } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, EmptyRow, Notice, PageHead } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDate } from "../../_lib/format";
import { deleteAffiliateAction, resetAffiliatePasswordAction, setAffiliateBalanceAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const rows = await listAffiliates();

  return (
    <>
      <PageHead
        title="Affiliates"
        desc="Streamer accounts. Each starts once with ₹10,000 live and ₹10,000 demo. Set either balance here; there are no daily resets. Their deposits and withdrawals never move real money."
        actions={
          <Link href="/admin/affiliates/new" className="admin-btn admin-btn--primary">
            <Icon name="plus" size={16} />
            New affiliate
          </Link>
        }
      />

      {sp.reset === "1" ? <Notice tone="pos">Password updated. The affiliate can sign in with it now.</Notice> : null}
      {sp.created === "1" ? <Notice tone="pos">Affiliate created. Share the email and password with them.</Notice> : null}
      {sp.balance === "1" ? <Notice tone="pos">Balance updated.</Notice> : null}
      {sp.error ? <Notice tone="neg">{sp.error}</Notice> : null}

      <section className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <th>Account</th>
                <th className="admin-num-right">Live</th>
                <th className="admin-num-right">Demo</th>
                <th>Created</th>
                <th className="admin-num-right">
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow cols={5} message="No affiliates yet. Use New affiliate to add one." />
              ) : (
                rows.map((row) => {
                  const name = row.nickname || row.email.split("@")[0] || row.email;
                  const balance = (type: "LIVE" | "DEMO") => {
                    const account = row.accounts.find(a => a.type === type);
                    return account ? formatMoney(account.realBalance + account.bonusBalance, account.currency) : "—";
                  };
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-cell-user">
                          <Avatar name={name} />
                          <div>
                            <div className="admin-cell-strong">{name}</div>
                            <div className="admin-cell-sub">{row.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="admin-num-right admin-amount">{balance("LIVE")}</td>
                      <td className="admin-num-right" style={{ color: "var(--admin-muted)" }}>
                        {balance("DEMO")}
                      </td>
                      <td className="admin-age">{fmtDate(row.createdAt)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <details className="admin-reject admin-affiliate-balance">
                            <summary className="admin-btn admin-btn--sm admin-btn--ghost">Set balance</summary>
                            <div className="admin-reject__panel">
                              <span className="admin-cell-sub">Available funds for {name}. Open trades continue to settle normally.</span>
                              {row.accounts.map(account => (
                                <form key={account.id} action={setAffiliateBalanceAction} style={{ display: "grid", gap: 8 }}>
                                  <input type="hidden" name="accountId" value={account.id} />
                                  <input type="hidden" name="currency" value={account.currency} />
                                  <input type="hidden" name="requestId" value={randomUUID()} />
                                  <label className="admin-label" htmlFor={`balance-${account.id}`}>
                                    {account.type} balance ({account.currency})
                                  </label>
                                  <input id={`balance-${account.id}`} type="number" name="amount" inputMode="decimal"
                                    min="0" step="0.01" required className="admin-input mono"
                                    defaultValue={((account.realBalance + account.bonusBalance) / 100).toFixed(2)} />
                                  <button type="submit" className="admin-btn admin-btn--sm admin-btn--primary">Save {account.type.toLowerCase()} balance</button>
                                </form>
                              ))}
                            </div>
                          </details>
                          <details className="admin-reject">
                            <summary className="admin-btn admin-btn--sm admin-btn--ghost">Reset password</summary>
                            <form action={resetAffiliatePasswordAction} className="admin-reject__panel">
                              <input type="hidden" name="userId" value={row.id} />
                              <label className="admin-label" htmlFor={`pw-${row.id}`}>
                                New password for {name}
                              </label>
                              <input
                                id={`pw-${row.id}`}
                                type="text"
                                name="password"
                                minLength={8}
                                required
                                autoComplete="new-password"
                                spellCheck={false}
                                className="admin-input mono"
                                style={{ height: 36, padding: "0 10px" }}
                              />
                              <button type="submit" className="admin-btn admin-btn--sm admin-btn--primary">
                                Save password
                              </button>
                            </form>
                          </details>
                          <details className="admin-reject">
                            <summary className="admin-icon-btn" aria-label={`More actions for ${name}`} style={{ width: 30, height: 30 }}>
                              <Icon name="more" size={18} strokeWidth={3} />
                            </summary>
                            <form action={deleteAffiliateAction} className="admin-reject__panel">
                              <input type="hidden" name="userId" value={row.id} />
                              <span style={{ fontSize: 13 }}>
                                Delete <b>{name}</b>? Their account and float go with it.
                              </span>
                              <button type="submit" className="admin-btn admin-btn--sm admin-btn--danger">
                                Delete affiliate
                              </button>
                            </form>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="admin-pager">
          <span className="info">
            {rows.length} affiliate{rows.length === 1 ? "" : "s"}
          </span>
        </div>
      </section>
    </>
  );
}
