import Link from "next/link";
import { listAffiliates } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, EmptyRow } from "../../_components/ui";
import { fmtDate, inrFromMinor } from "../../_lib/format";
import {
  deleteAffiliateAction,
  resetAffiliatePasswordAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function AffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const resetOk = sp.reset === "1";
  const error = sp.error;
  const rows = await listAffiliates();

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <strong>Streamer accounts</strong>
          <span className="admin-cell-sub" style={{ fontSize: 12 }}>
            ₹10,000 LIVE + ₹10,000 DEMO float, reset every day at 00:00 IST.
            Deposits and withdrawals render but never move money.
          </span>
        </div>
        <Link
          href="/admin/affiliates/new"
          className="admin-btn admin-btn--sm admin-btn--pos"
        >
          Create affiliate
        </Link>
      </div>

      {resetOk ? (
        <div
          role="status"
          style={{
            margin: "0 16px 12px",
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(34, 197, 94, 0.08)",
            color: "#22c55e",
            fontSize: 13,
          }}
        >
          Password updated. The affiliate can log in with the new password now.
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          style={{
            margin: "0 16px 12px",
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.08)",
            color: "#ef4444",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="admin-num-right">LIVE</th>
              <th className="admin-num-right">DEMO</th>
              <th className="admin-num-right">Last reset</th>
              <th className="admin-num-right">Created</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow
                cols={6}
                message="No affiliates yet. Click Create affiliate to add one."
              />
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
                    <td className="num admin-num-right">
                      {inrFromMinor(row.liveBalance)}
                    </td>
                    <td className="num admin-num-right">
                      {inrFromMinor(row.demoBalance)}
                    </td>
                    <td className="num admin-num-right">
                      {row.lastResetAt ? fmtDate(row.lastResetAt) : "—"}
                    </td>
                    <td className="num admin-num-right">
                      {fmtDate(row.createdAt)}
                    </td>
                    <td>
                      <div
                        className="admin-row-actions"
                        style={{
                          justifyContent: "flex-end",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <form
                          action={resetAffiliatePasswordAction}
                          style={{ display: "flex", gap: 6, alignItems: "center" }}
                        >
                          <input type="hidden" name="userId" value={row.id} />
                          <input
                            type="text"
                            name="password"
                            placeholder="New password"
                            minLength={8}
                            required
                            autoComplete="new-password"
                            spellCheck={false}
                            style={{
                              padding: "4px 8px",
                              fontSize: 12,
                              fontFamily:
                                "ui-monospace, SFMono-Regular, monospace",
                              borderRadius: 6,
                              border: "1px solid var(--admin-border)",
                              background: "var(--admin-bg-input)",
                              color: "inherit",
                              width: 140,
                            }}
                          />
                          <button
                            type="submit"
                            className="admin-btn admin-btn--sm admin-btn--subtle"
                          >
                            Set password
                          </button>
                        </form>
                        <form action={deleteAffiliateAction}>
                          <input type="hidden" name="userId" value={row.id} />
                          <button
                            type="submit"
                            className="admin-btn admin-btn--sm admin-btn--danger"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
