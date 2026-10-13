import Link from "next/link";
import { listAffiliates } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, EmptyRow, Notice, PageHead } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDate, inrFromMinor } from "../../_lib/format";
import { deleteAffiliateAction, resetAffiliatePasswordAction } from "./actions";

export const dynamic = "force-dynamic";

function lastReset(d: Date | null): string {
  if (!d) return "—";
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? `Today, ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : fmtDate(d);
}

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
        desc="Streamer accounts. Each starts the day with ₹10,000 live and ₹10,000 demo, reset at 00:00 IST. Their deposits and withdrawals never move real money."
        actions={
          <Link href="/admin/affiliates/new" className="admin-btn admin-btn--primary">
            <Icon name="plus" size={16} />
            New affiliate
          </Link>
        }
      />

      {sp.reset === "1" ? <Notice tone="pos">Password updated. The affiliate can sign in with it now.</Notice> : null}
      {sp.created === "1" ? <Notice tone="pos">Affiliate created. Share the email and password with them.</Notice> : null}
      {sp.error ? <Notice tone="neg">{sp.error}</Notice> : null}

      <section className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <th>Account</th>
                <th className="admin-num-right">Live</th>
                <th className="admin-num-right">Demo</th>
                <th>Last reset</th>
                <th>Created</th>
                <th className="admin-num-right">
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow cols={6} message="No affiliates yet. Use New affiliate to add one." />
              ) : (
                rows.map((row) => {
                  const name = row.nickname || row.email.split("@")[0] || row.email;
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
                      <td className="admin-num-right admin-amount">{inrFromMinor(row.liveBalance)}</td>
                      <td className="admin-num-right" style={{ color: "var(--admin-muted)" }}>
                        {inrFromMinor(row.demoBalance)}
                      </td>
                      <td className="admin-age">{lastReset(row.lastResetAt)}</td>
                      <td className="admin-age">{fmtDate(row.createdAt)}</td>
                      <td>
                        <div className="admin-row-actions">
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
