import { listOrphanBankCredits, listPendingDeposits, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, Card, StatCard, StatusPill } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDateTime, inrFromMinor, timeAgo, usdCompactFromMinor, usdFromMinor } from "../../_lib/format";
import { approveDepositAction, approveWithdrawalAction, rejectDepositAction } from "./actions";

export const dynamic = "force-dynamic";

function userName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email.split("@")[0]!;
}

export default async function ApprovalsPage() {
  await requireAdmin();

  const [pending, withdrawals, orphans, recent, pendingAgg] = await Promise.all([
    listPendingDeposits(50),
    prisma.withdrawal.findMany({
      where: { status: "REQUESTED" },
      orderBy: { createdAt: "asc" },
      take: 50,
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    }),
    listOrphanBankCredits(50),
    prisma.deposit.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    }),
    prisma.deposit.aggregate({
      where: { status: "PENDING_CONFIRMATION" },
      _sum: { amountUsd: true },
    }),
  ]);

  const withdrawalsUsd = withdrawals.reduce((s, w) => s + w.amount, 0);

  return (
    <>
      <div className="admin-grid admin-stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <StatCard
          label="Deposits in review"
          value={String(pending.length)}
          icon="inbox"
          warn={pending.length > 0}
          foot={<span>{usdCompactFromMinor(pendingAgg._sum.amountUsd ?? 0)} awaiting vouch</span>}
        />
        <StatCard
          label="Withdrawals requested"
          value={String(withdrawals.length)}
          icon="dollar"
          warn={withdrawals.length > 0}
          foot={<span>{usdCompactFromMinor(withdrawalsUsd)} to release</span>}
        />
        <StatCard
          label="Orphaned credits"
          value={String(orphans.length)}
          icon="shield"
          foot={<span>need manual matching</span>}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Deposits awaiting review" sub="Only the residue reaches here — exact and amount-only matches settle automatically.">
          {pending.length === 0 ? (
            <div className="admin-empty">
              <Icon name="check" size={34} />
              <div>Nothing awaiting review. The deposit queue is clear.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pending.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 14,
                    padding: 14,
                    border: "1px solid var(--admin-border)",
                    borderRadius: "var(--admin-radius-sm)",
                    background: "var(--admin-surface-2)",
                  }}
                >
                  <span className="admin-delta up" style={{ background: "none", padding: 0 }}>
                    <Icon name="arrowDown" size={14} />
                  </span>
                  <div>
                    <div className="admin-cell-strong num">{usdFromMinor(d.amountUsd)}</div>
                    <div className="admin-cell-sub num">
                      {inrFromMinor(d.amountInr)} · {d.method}
                    </div>
                  </div>
                  <div className="mono admin-cell-sub" style={{ fontSize: 12 }}>
                    {d.claimedUtr ?? "no reference"}
                  </div>
                  {d.screenshotUrl ? (
                    <a
                      href={d.screenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the payment screenshot the user attached"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 6px",
                        border: "1px solid var(--admin-border)",
                        borderRadius: "var(--admin-radius-sm)",
                        background: "var(--admin-surface)",
                        textDecoration: "none",
                      }}
                    >
                      <img
                        src={d.screenshotUrl}
                        alt=""
                        width={36}
                        height={36}
                        style={{ objectFit: "cover", borderRadius: 3 }}
                      />
                      <span className="admin-cell-sub" style={{ fontSize: 11 }}>
                        screenshot
                      </span>
                    </a>
                  ) : (
                    <span className="admin-cell-sub" style={{ fontSize: 11, opacity: 0.6 }}>
                      no screenshot
                    </span>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <form action={rejectDepositAction}>
                      <input type="hidden" name="depositId" value={d.id} />
                      <input type="hidden" name="reason" value="no matching credit found" />
                      <button type="submit" className="admin-btn admin-btn--sm admin-btn--danger">
                        Reject
                      </button>
                    </form>
                    <form action={approveDepositAction}>
                      <input type="hidden" name="depositId" value={d.id} />
                      <button type="submit" className="admin-btn admin-btn--sm admin-btn--pos">
                        Approve
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Withdrawals requested" sub="Approving transitions the request to APPROVED for payout.">
          {withdrawals.length === 0 ? (
            <div className="admin-empty">
              <Icon name="check" size={34} />
              <div>No withdrawals awaiting approval.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {withdrawals.map((w) => {
                const name = userName(w.user);
                return (
                  <div
                    key={w.id}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 14,
                      padding: 14,
                      border: "1px solid var(--admin-border)",
                      borderRadius: "var(--admin-radius-sm)",
                      background: "var(--admin-surface-2)",
                    }}
                  >
                    <div className="admin-cell-user">
                      <Avatar name={name} />
                      <div>
                        <div className="admin-cell-strong">{name}</div>
                        <div className="admin-cell-sub">{w.user.email}</div>
                      </div>
                    </div>
                    <div>
                      <div className="admin-cell-strong num">{usdFromMinor(w.amount)}</div>
                      <div className="admin-cell-sub">{w.method}</div>
                    </div>
                    <div className="admin-cell-sub">requested {timeAgo(w.createdAt)}</div>
                    <div style={{ marginLeft: "auto" }}>
                      <form action={approveWithdrawalAction}>
                        <input type="hidden" name="withdrawalId" value={w.id} />
                        <button type="submit" className="admin-btn admin-btn--sm admin-btn--pos">
                          Approve payout
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="admin-grid admin-cols-2" style={{ marginTop: 16 }}>
        <Card title="Orphaned bank credits" sub="Received money with no matching deposit." noBody>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th className="admin-num-right">Amount</th>
                  <th>UTR</th>
                </tr>
              </thead>
              <tbody>
                {orphans.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="admin-empty">
                        <Icon name="check" size={34} />
                        <div>No orphaned credits.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  orphans.map((c) => (
                    <tr key={c.id}>
                      <td className="admin-cell-sub">{fmtDateTime(c.receivedAt)}</td>
                      <td className="num admin-num-right">{inrFromMinor(c.amountInr)}</td>
                      <td className="mono admin-cell-sub">{c.utr}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Recent deposits" noBody>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th className="admin-num-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="admin-empty">
                        <Icon name="inbox" size={34} />
                        <div>No deposits yet.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  recent.map((d) => (
                    <tr key={d.id}>
                      <td className="admin-cell-sub">{d.user.email}</td>
                      <td className="num admin-num-right">{usdFromMinor(d.amountUsd)}</td>
                      <td>
                        <StatusPill status={d.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
