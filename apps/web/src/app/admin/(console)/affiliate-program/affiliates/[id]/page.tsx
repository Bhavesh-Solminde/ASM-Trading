import Link from "next/link";
import { notFound } from "next/navigation";
import { getAffiliateAdminDetail } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Card, EmptyRow, Notice, PageHead, Pill } from "../../../../_components/ui";
import { inrFromMinor, num } from "../../../../_lib/format";
import { assignAffiliateRateAction, setAffiliateStatusAction } from "../../actions";
import { fmtIst } from "../../parse";
import { AffiliateStatusPill, bpsPct } from "../../program-ui";

export const dynamic = "force-dynamic";

/** Status changes the admin can make from each status (mirrors setAffiliateStatus). */
const MOVES: Record<string, { status: "ACTIVE" | "SUSPENDED"; label: string; tone: "pos" | "danger" }[]> = {
  PENDING_VERIFICATION: [{ status: "SUSPENDED", label: "Suspend", tone: "danger" }],
  PENDING_APPROVAL: [
    { status: "SUSPENDED", label: "Suspend", tone: "danger" },
    { status: "ACTIVE", label: "Approve", tone: "pos" },
  ],
  ACTIVE: [{ status: "SUSPENDED", label: "Suspend", tone: "danger" }],
  SUSPENDED: [{ status: "ACTIVE", label: "Reinstate", tone: "pos" }],
};

export default async function AffiliateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const a = await getAffiliateAdminDetail(id);
  if (!a) notFound();

  const w = a.wallet ?? { availableMinor: 0, reservedMinor: 0, transferredMinor: 0, paidMinor: 0 };
  const moves = MOVES[a.status] ?? [];
  const openFlags = a.flags.filter((f) => f.status === "OPEN").length;

  return (
    <>
      <PageHead
        title={a.name ?? a.email}
        back={{ href: "/admin/affiliate-program?tab=affiliates", label: "Affiliates" }}
        desc={
          <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {a.email} · joined {fmtIst(a.createdAt)}
            <AffiliateStatusPill status={a.status} />
            <Pill tone={a.kycStatus === "VERIFIED" ? "pos" : a.kycStatus === "PENDING" ? "warn" : "muted"}>
              KYC {a.kycStatus.toLowerCase().replace("_", " ")}
            </Pill>
            {a.userStatus !== "ACTIVE" ? <Pill tone="neg">Account {a.userStatus.toLowerCase()}</Pill> : null}
          </span>
        }
        actions={
          <Link className="admin-btn admin-btn--ghost" href={`/admin/users/${a.userId}`}>
            Open user account
          </Link>
        }
      />
      {sp.error ? <Notice tone="neg">{sp.error}</Notice> : sp.ok ? <Notice tone="pos">{sp.ok}</Notice> : null}

      <section className="admin-card admin-strip" aria-label="Program wallet">
        <div className="admin-strip__cell">
          <span className="admin-label">Available</span>
          <span className="admin-strip__val">{inrFromMinor(w.availableMinor)}</span>
          <span className="admin-cell-sub">Can transfer or withdraw</span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Reserved</span>
          <span className="admin-strip__val">{inrFromMinor(w.reservedMinor)}</span>
          <span className="admin-cell-sub">In open withdrawals</span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Transferred</span>
          <span className="admin-strip__val">{inrFromMinor(w.transferredMinor)}</span>
          <span className="admin-cell-sub">To trading account</span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Paid out</span>
          <span className="admin-strip__val">{inrFromMinor(w.paidMinor)}</span>
          <span className="admin-cell-sub">Withdrawals paid</span>
        </div>
      </section>

      <div className="admin-grid admin-cols-2" style={{ alignItems: "start" }}>
        <Card title="Referrals and earnings" sub="Totals only; no per-user data">
          <dl className="admin-dl">
            <dt>Referrals</dt>
            <dd>{num(a.totalReferrals)}</dd>
            <dt>Qualified</dt>
            <dd>{num(a.qualifiedReferrals)}</dd>
            <dt>Deposited by qualified referrals</dt>
            <dd>{inrFromMinor(a.totalDepositedMinor)}</dd>
            <dt>Earnings pending</dt>
            <dd>{inrFromMinor(a.earnings.PENDING)}</dd>
            <dt>Earnings held</dt>
            <dd>{inrFromMinor(a.earnings.HELD)}</dd>
            <dt>Earnings available (lifetime)</dt>
            <dd>{inrFromMinor(a.earnings.AVAILABLE)}</dd>
            <dt>Earnings voided</dt>
            <dd>{inrFromMinor(a.earnings.VOID)}</dd>
            <dt>Self-referral flags</dt>
            <dd>
              {a.flags.length ? (
                <Link className="admin-link" href="/admin/fraud">
                  {openFlags} open, {a.flags.length - openFlags} confirmed
                </Link>
              ) : (
                "None"
              )}
            </dd>
          </dl>
        </Card>

        <Card
          title="Status"
          sub={a.statusReason ? `Last change: ${a.statusReason}${a.statusChangedAt ? ` · ${fmtIst(a.statusChangedAt)}` : ""}` : undefined}
        >
          {moves.length ? (
            <form action={setAffiliateStatusAction} style={{ display: "grid", gap: 12 }}>
              <input type="hidden" name="userId" value={a.userId} />
              <div className="admin-field" style={{ marginBottom: 0 }}>
                <label htmlFor="status-reason">Reason</label>
                <input id="status-reason" name="reason" className="admin-input" required maxLength={500} />
              </div>
              <div className="admin-row-actions" style={{ justifyContent: "flex-start" }}>
                {moves.map((m) => (
                  <button key={m.status} type="submit" name="status" value={m.status} className={`admin-btn admin-btn--${m.tone}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="admin-cell-sub">
                While not active, new earnings are held and transfers and withdrawals are refused. Referral links keep working.
              </div>
            </form>
          ) : (
            <div className="admin-cell-sub">No status change available.</div>
          )}
        </Card>
      </div>

      <Card
        title="Rates"
        sub={
          a.currentRate
            ? `In force: Revenue Share ${bpsPct(a.currentRate.revenueShareBps)}, deposit reward ${
                a.currentRate.depositRewardBps === null ? "global setting" : bpsPct(a.currentRate.depositRewardBps)
              }`
            : "No rate assigned: Revenue Share is 0% and the deposit reward follows the global setting"
        }
      >
        <form action={assignAffiliateRateAction} className="admin-grid admin-cols-2" style={{ alignItems: "end", marginBottom: 16 }}>
          <input type="hidden" name="affiliateId" value={a.userId} />
          <div className="admin-field" style={{ marginBottom: 0 }}>
            <label htmlFor="rate-rs">Revenue Share (%)</label>
            <input id="rate-rs" name="revenueSharePct" className="admin-input" required inputMode="decimal" placeholder="e.g. 30" />
          </div>
          <div className="admin-field" style={{ marginBottom: 0 }}>
            <label htmlFor="rate-dep">Deposit reward override (%, optional)</label>
            <input id="rate-dep" name="depositRewardPct" className="admin-input" inputMode="decimal" placeholder="Empty = global setting" />
          </div>
          <div className="admin-field" style={{ marginBottom: 0 }}>
            <label htmlFor="rate-from">Effective from (IST, empty = now)</label>
            <input id="rate-from" name="effectiveFrom" type="datetime-local" className="admin-input" />
          </div>
          <div className="admin-field" style={{ marginBottom: 0 }}>
            <label htmlFor="rate-reason">Reason</label>
            <input id="rate-reason" name="reason" className="admin-input" required maxLength={500} />
          </div>
          <div>
            <button type="submit" className="admin-btn admin-btn--primary">
              Assign rate
            </button>
          </div>
        </form>
        <div className="admin-cell-sub" style={{ marginBottom: 12 }}>
          Applies to activity from the effective time onward; closed days are never recalculated.
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <th>Effective from</th>
                <th className="admin-num-right">Revenue Share</th>
                <th className="admin-num-right">Deposit reward</th>
                <th>By</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {a.rates.length === 0 ? (
                <EmptyRow cols={5} message="No rate history." />
              ) : (
                a.rates.map((r) => (
                  <tr key={r.id}>
                    <td className="admin-cell-sub">
                      {fmtIst(r.effectiveFrom)} {r.id === a.currentRate?.rateId ? <Pill tone="pos">In force</Pill> : null}
                    </td>
                    <td className="admin-num-right">{bpsPct(r.revenueShareBps)}</td>
                    <td className="admin-num-right">{r.depositRewardBps === null ? "Global" : bpsPct(r.depositRewardBps)}</td>
                    <td className="admin-cell-sub">{r.createdBy}</td>
                    <td className="admin-cell-sub">{r.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
