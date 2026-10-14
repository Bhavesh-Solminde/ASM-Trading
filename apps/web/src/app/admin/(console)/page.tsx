import Link from "next/link";
import { countOpenReconciliationIssues, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { AutoRefresh } from "../_components/AutoRefresh";
import { BarChart, Card, PageHead } from "../_components/ui";
import { Icon, type IconName } from "../_lib/icons";
import { inrCompactFromMinor, inrFromMinor, num, timeAgo } from "../_lib/format";
import { auditSentence, auditTone } from "../_lib/audit";

export const dynamic = "force-dynamic";

const DAY = 86400000;

const HOUR = 3600_000;

/** How long the oldest item has waited, as a short age ("1h", "2d"). */
function age(date: Date | null | undefined): string | null {
  return date ? timeAgo(date).replace(" ago", "") : null;
}

type Sla = "ok" | "warn" | "late";
const SLA_WORD: Record<Sla, string> = { ok: "On time", warn: "Getting old", late: "Overdue" };

/** Each queue's own clock: how long its oldest item may wait before it's "getting old" / "overdue". */
function sla(oldest: Date | null | undefined, warnAfterH: number, lateAfterH: number): Sla {
  if (!oldest) return "ok";
  const h = (Date.now() - oldest.getTime()) / HOUR;
  return h >= lateAfterH ? "late" : h >= warnAfterH ? "warn" : "ok";
}

type Queue = {
  key: "deposit" | "withdraw" | "kyc" | "fraud" | "recon";
  href: string;
  title: string;
  sub: string;
  icon: IconName;
  count: number;
  money: React.ReactNode;
  oldestAt: Date | null;
  oldestLabel: string;
  sla: Sla;
};

const ACTIVITY_ICON: Record<string, IconName> = { pos: "check", neg: "x", warn: "clock", "": "activity" };

export default async function OverviewPage() {
  await requireAdmin();

  const since30 = new Date(Date.now() - 30 * DAY);
  // Affiliate accounts never move real money — leave them out of every queue.
  const notAffiliate = { user: { role: { not: "AFFILIATE" as const } } };

  const [
    pendingDeposits,
    oldestDeposit,
    requestedWithdrawals,
    oldestWithdrawal,
    approvedWithdrawals,
    pendingKyc,
    oldestKyc,
    openFlags,
    reconciliation,
    oldestP1,
    userCount,
    completedDeposits,
    openMarkets,
    totalMarkets,
    openTickets,
    volumeRows,
    recentAudit,
  ] = await Promise.all([
    prisma.deposit.aggregate({
      where: { status: "PENDING_CONFIRMATION", ...notAffiliate },
      _count: { _all: true },
      _sum: { amountInr: true },
    }),
    prisma.deposit.findFirst({
      where: { status: "PENDING_CONFIRMATION", ...notAffiliate },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.withdrawal.aggregate({
      where: { status: "REQUESTED", ...notAffiliate },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.withdrawal.findFirst({
      where: { status: "REQUESTED", ...notAffiliate },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.withdrawal.count({ where: { status: "APPROVED", ...notAffiliate } }),
    prisma.user.count({ where: { kycStatus: "PENDING" } }),
    prisma.user.findFirst({
      where: { kycStatus: "PENDING", kycSubmittedAt: { not: null } },
      orderBy: { kycSubmittedAt: "asc" },
      select: { kycSubmittedAt: true },
    }),
    prisma.fraudFlag.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, evidence: true },
    }),
    countOpenReconciliationIssues(),
    prisma.reconciliationIssue.findFirst({
      where: { status: "OPEN", severity: "P1" },
      orderBy: { firstDetectedAt: "asc" },
      select: { firstDetectedAt: true },
    }),
    prisma.user.count({ where: { role: { not: "AFFILIATE" } } }),
    prisma.deposit.aggregate({
      where: { status: "COMPLETED", ...notAffiliate },
      _sum: { amountInr: true },
    }),
    prisma.asset.count({ where: { isOpen: true } }),
    prisma.asset.count(),
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
    prisma.$queryRaw<{ day: Date; total: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COALESCE(SUM("stake"), 0)::bigint AS total
      FROM "Trade"
      WHERE "createdAt" >= ${since30}
      GROUP BY 1 ORDER BY 1`,
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
  ]);

  // --- 30-day volume series, one point per day ---
  const byDay = new Map<string, number>();
  for (const r of volumeRows) byDay.set(new Date(r.day).toISOString().slice(0, 10), Number(r.total));
  const series: { label: string; value: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    series.push({
      label: i === 0 ? "Today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: byDay.get(d.toISOString().slice(0, 10)) ?? 0,
    });
  }
  const totalVolume = series.reduce((s, d) => s + d.value, 0);

  const strongFlags = openFlags.filter(
    (f) => (f.evidence as { verdict?: string } | null)?.verdict === "LINKED",
  ).length;

  const queues: Queue[] = [
    {
      key: "deposit",
      href: "/admin/deposits",
      title: "Deposits",
      sub: "UTR didn't match a bank SMS on its own",
      icon: "depositIn",
      count: pendingDeposits._count._all,
      money: pendingDeposits._count._all ? (
        <>
          {inrFromMinor(pendingDeposits._sum.amountInr ?? 0, 0)} <span className="admin-cell-sub">to confirm</span>
        </>
      ) : null,
      oldestAt: oldestDeposit?.createdAt ?? null,
      oldestLabel: "oldest",
      // traders are waiting on the money: an hour is long, two is overdue
      sla: sla(oldestDeposit?.createdAt, 1, 2),
    },
    {
      key: "withdraw",
      href: "/admin/withdrawals",
      title: "Withdrawals",
      sub:
        "Check the payee against KYC" +
        (approvedWithdrawals ? ` · ${approvedWithdrawals} more approved, waiting to be paid` : ""),
      icon: "payoutOut",
      count: requestedWithdrawals._count._all,
      money: requestedWithdrawals._count._all ? (
        <>
          {inrFromMinor(requestedWithdrawals._sum.amount ?? 0, 0)} <span className="admin-cell-sub">to pay out</span>
        </>
      ) : null,
      oldestAt: oldestWithdrawal?.createdAt ?? null,
      oldestLabel: "oldest",
      sla: sla(oldestWithdrawal?.createdAt, 6, 12),
    },
    {
      key: "kyc",
      href: "/admin/kyc",
      title: "KYC",
      sub: "Documents to verify · withdrawals stay locked until then",
      icon: "idCard",
      count: pendingKyc,
      money: null,
      oldestAt: oldestKyc?.kycSubmittedAt ?? null,
      oldestLabel: "oldest",
      sla: sla(oldestKyc?.kycSubmittedAt, 12, 24),
    },
    {
      key: "fraud",
      href: "/admin/fraud",
      title: "Fraud flags",
      sub: "Accounts linked by IP, device or timing",
      icon: "shieldAlert",
      count: openFlags.length,
      money: strongFlags ? <>{strongFlags} strongly linked</> : null,
      oldestAt: openFlags[0]?.createdAt ?? null,
      oldestLabel: "oldest",
      sla: sla(openFlags[0]?.createdAt, 4, 12),
    },
    {
      key: "recon",
      href: "/admin/reconciliation",
      title: "Reconciliation",
      sub: "USDT deposits checked against on-chain credits",
      icon: "ledger",
      count: reconciliation.p1,
      money:
        reconciliation.p1 || reconciliation.warning ? (
          <>
            {reconciliation.p1 ? "P1" : "No P1"}{" "}
            {reconciliation.warning ? (
              <span className="admin-cell-sub">
                + {reconciliation.warning} warning{reconciliation.warning === 1 ? "" : "s"}
              </span>
            ) : null}
          </>
        ) : null,
      oldestAt: oldestP1?.firstDetectedAt ?? null,
      oldestLabel: "first seen",
      // a P1 should be structurally impossible: any open one is overdue
      sla: reconciliation.p1 ? "late" : "ok",
    },
  ];
  const waiting = queues.reduce((s, q) => s + q.count, 0);
  const overdue = queues.filter((q) => q.count && q.sla === "late").length;
  const rank: Record<Sla, number> = { late: 0, warn: 1, ok: 2 };
  // The single most pressing queue: worst clock first, then longest wait.
  const mostUrgent = queues
    .filter((q) => q.count)
    .sort((a, b) => rank[a.sla] - rank[b.sla] || (a.oldestAt?.getTime() ?? 0) - (b.oldestAt?.getTime() ?? 0))[0];
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHead
        title="Overview"
        desc={
          waiting ? (
            <>
              {today} · {waiting} item{waiting === 1 ? " is" : "s are"} waiting for a decision
              {overdue ? (
                <span style={{ color: "var(--sla-late)", fontWeight: 600 }}>
                  {" "}
                  · {overdue} queue{overdue === 1 ? " is" : "s are"} overdue
                </span>
              ) : null}
              .
            </>
          ) : (
            `${today} · Every queue is clear.`
          )
        }
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <AutoRefresh seconds={30} />
            {mostUrgent ? (
              <Link className="admin-btn admin-btn--primary" href={mostUrgent.href}>
                Review most overdue
                <Icon name="arrowRight" size={16} />
              </Link>
            ) : null}
          </div>
        }
      />

      <Card title="Needs a decision" action={<SlaLegend />} noBody>
        {queues.map((q) => (
          <Link key={q.href} href={q.href} className={`admin-q q-${q.key}${q.count === 0 ? " is-clear" : ""}`}>
            <span className="admin-q__ic">
              <Icon name={q.icon} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="admin-q__title">{q.title}</span>
              <span className="admin-q__sub">{q.sub}</span>
            </span>
            <span className="admin-q__n">{q.count}</span>
            <span className="admin-q__money">
              {q.count ? (
                q.money
              ) : (
                <span className="admin-q__clear">
                  <Icon name="check" size={15} />
                  All clear
                </span>
              )}
            </span>
            <span className="admin-q__age">
              {q.count && q.oldestAt ? (
                <span className={`admin-sla admin-sla--${q.sla}`} title={SLA_WORD[q.sla]}>
                  <b>{age(q.oldestAt)}</b> {q.oldestLabel}
                </span>
              ) : null}
            </span>
            <span className="admin-q__go">{q.count ? "Review" : "Open"}</span>
          </Link>
        ))}
      </Card>

      <section className="admin-card admin-strip" aria-label="Platform numbers">
        <div className="admin-strip__cell">
          <span className="admin-label">Registered users</span>
          <span className="admin-strip__val">{num(userCount)}</span>
          <span className="admin-cell-sub">Affiliates excluded</span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Settled deposits</span>
          <span className="admin-strip__val">{inrCompactFromMinor(completedDeposits._sum.amountInr ?? 0)}</span>
          <span className="admin-cell-sub">All time</span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Markets open</span>
          <span className="admin-strip__val">
            {openMarkets} <small>/ {totalMarkets}</small>
          </span>
          <span className="admin-cell-sub" style={totalMarkets - openMarkets ? { color: "var(--sla-warn)" } : undefined}>
            {totalMarkets - openMarkets ? `${totalMarkets - openMarkets} paused` : "None paused"}
          </span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Support tickets</span>
          <span className="admin-strip__val">{openTickets}</span>
          <span className="admin-cell-sub">Open</span>
        </div>
      </section>

      <div className="admin-grid admin-cols-3">
        <Card
          title="Trade volume"
          sub="Total staked per day, last 30 days"
          action={
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
              {inrCompactFromMinor(totalVolume)}
            </span>
          }
        >
          {totalVolume > 0 ? (
            <BarChart
              points={series.map((s) => s.value)}
              labels={series.map((s) => s.label)}
              format={(v) => inrCompactFromMinor(v)}
            />
          ) : (
            <div className="admin-empty">
              <Icon name="activity" size={30} />
              <div>No trades in the last 30 days.</div>
            </div>
          )}
        </Card>

        <Card
          title="Recent activity"
          action={
            <Link className="admin-link" href="/admin/audit" style={{ fontSize: 13 }}>
              Audit log
            </Link>
          }
          noBody
        >
          <div className="admin-feed">
            {recentAudit.map((a) => {
              const tone = auditTone(a.action);
              return (
                <div className="admin-feed__item" key={a.id}>
                  <span className={`admin-feed__ic ${tone}`}>
                    <Icon name={ACTIVITY_ICON[tone] ?? "activity"} size={14} />
                  </span>
                  <div className="admin-feed__main">
                    <div className="admin-feed__txt">{auditSentence(a.action, a.after)}</div>
                    <div className="admin-feed__meta">
                      {a.actorId && a.actorId !== "admin-panel" ? a.actorId : "Operator"} · {timeAgo(a.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
            {recentAudit.length === 0 ? (
              <div className="admin-empty">
                <Icon name="scroll" size={30} />
                <div>No audited actions yet.</div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}

/** What the colours on waiting times mean. */
function SlaLegend() {
  return (
    <span className="admin-sla-legend" aria-label="Wait colours">
      <span className="admin-sla admin-sla--ok">On time</span>
      <span className="admin-sla admin-sla--warn">Getting old</span>
      <span className="admin-sla admin-sla--late">Overdue</span>
    </span>
  );
}
