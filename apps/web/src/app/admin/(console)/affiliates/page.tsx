import Link from "next/link";
import { listAffiliates } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, EmptyRow } from "../../_components/ui";
import { fmtDate, inrFromMinor } from "../../_lib/format";
import { deleteAffiliateAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AffiliatesPage() {
  await requireAdmin();
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
                        style={{ justifyContent: "flex-end" }}
                      >
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
