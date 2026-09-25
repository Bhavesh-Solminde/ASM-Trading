import Link from "next/link";
import { prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { AreaChart, Card, Donut, StatCard } from "../_components/ui";
import { Icon, type IconName } from "../_lib/icons";
import { avatarColor, num, timeAgo, usdCompactFromMinor } from "../_lib/format";

export const dynamic = "force-dynamic";

const DAY = 86400000;
const ALLOC_COLORS = ["#8A6215", "#2C5A8A", "#157F52", "#B0563A", "#6B4A9E", "#8b8578"];
const AUDIT_ICON: Record<string, IconName> = {
  asset: "coins",
  deposit: "inbox",
  withdrawal: "inbox",
  user: "users",
  account: "users",
  ticket: "ticket",
};

export default async function OverviewPage() {
  await requireAdmin();

  const since30 = new Date(Date.now() - 30 * DAY);

  const [
    userCount,
    completedDeposits,
    pendingDeposits,
    requestedWithdrawals,
    openTickets,
    openMarkets,
    totalMarkets,
    volumeRows,
    byAsset,
    assets,
    recentAudit,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.deposit.aggregate({ where: { status: "COMPLETED" }, _sum: { amountUsd: true } }),
    prisma.deposit.count({ where: { status: "PENDING_CONFIRMATION" } }),
    prisma.withdrawal.count({ where: { status: "REQUESTED" } }),
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
    prisma.asset.count({ where: { isOpen: true } }),
    prisma.asset.count(),
    prisma.$queryRaw<{ day: Date; total: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COALESCE(SUM("stake"), 0) AS total
      FROM "Trade"
      WHERE "createdAt" >= ${since30}
      GROUP BY 1 ORDER BY 1`,
    prisma.trade.groupBy({
      by: ["assetId"],
      where: { createdAt: { gte: since30 } },
      _sum: { stake: true },
      _count: { _all: true },
    }),
    prisma.asset.findMany({ orderBy: { symbol: "asc" } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
  ]);

  // --- volume series: fill 30 days from the grouped rows ---
  const byDay = new Map<string, number>();
  for (const r of volumeRows) byDay.set(new Date(r.day).toISOString().slice(0, 10), Number(r.total));
  const series: { label: string; value: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    const key = d.toISOString().slice(0, 10);
    series.push({
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: byDay.get(key) ?? 0,
    });
  }
  const totalVolume = series.reduce((s, d) => s + d.value, 0);

  // --- per-market volume from trade aggregates ---
  const aggById = new Map(byAsset.map((a) => [a.assetId, a]));
  const markets = assets
    .map((a) => {
      const agg = aggById.get(a.id);
      return {
        symbol: a.symbol,
        name: a.displayName,
        price: a.basePrice,
        isOpen: a.isOpen,
        vol: agg?._sum.stake ?? 0,
        trades: agg?._count._all ?? 0,
      };
    })
    .sort((x, y) => y.vol - x.vol);
  const topMarkets = markets.slice(0, 6);

  const allocTotal = markets.reduce((s, m) => s + m.vol, 0);
  const allocation =
    allocTotal > 0
      ? (() => {
          const top = markets.slice(0, 5);
          const otherPct = Math.max(
            0,
            100 - top.reduce((s, m) => s + Math.round((m.vol / allocTotal) * 100), 0),
          );
          const segs = top.map((m, i) => ({
            label: m.symbol,
            pct: Math.round((m.vol / allocTotal) * 100),
            color: ALLOC_COLORS[i]!,
          }));
          if (otherPct > 0) segs.push({ label: "Other", pct: otherPct, color: ALLOC_COLORS[5]! });
          return segs;
        })()
      : [];

  const completedSum = completedDeposits._sum.amountUsd ?? 0;
  const pendingApprovals = pendingDeposits + requestedWithdrawals;

  return (
    <>
      <div className="admin-grid admin-stat-grid">
        <StatCard
          label="Registered users"
          value={num(userCount)}
          icon="users"
          foot={<span>across live &amp; demo accounts</span>}
        />
        <StatCard
          label="Settled deposits"
          value={usdCompactFromMinor(completedSum)}
          icon="dollar"
          foot={<span>{openMarkets} of {totalMarkets} markets open</span>}
        />
        <StatCard
          label="Pending approvals"
          value={String(pendingApprovals)}
          icon="inbox"
          warn={pendingApprovals > 0}
          foot={
            <span>
              <Link href="/admin/deposits" style={{ color: "inherit" }}>{pendingDeposits} deposits</Link>
              {" · "}
              <Link href="/admin/withdrawals" style={{ color: "inherit" }}>{requestedWithdrawals} withdrawals</Link>
            </span>
          }
        />
        <StatCard
          label="Open tickets"
          value={String(openTickets)}
          icon="ticket"
          foot={<span>support queue</span>}
        />
      </div>

      <div className="admin-grid admin-cols-3" style={{ marginTop: 16 }}>
        <Card noBody>
          <div className="admin-chart-head">
            <div>
              <h3>30-day trade volume</h3>
              <div className="big">{usdCompactFromMinor(totalVolume)}</div>
              <div className="admin-stat__foot">
                <span>total staked across all markets</span>
              </div>
            </div>
          </div>
          <div className="admin-card__body" style={{ paddingTop: 6 }}>
            {totalVolume > 0 ? (
              <AreaChart
                points={series.map((s) => s.value)}
                labels={series.map((s) => s.label)}
              />
            ) : (
              <div className="admin-empty">
                <Icon name="activity" size={34} />
                <div>No trades recorded in the last 30 days.</div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Volume by market">
          <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            {allocation.length > 0 ? (
              <>
                <div style={{ flex: "none" }}>
                  <Donut
                    segments={allocation}
                    centerLabel={String(totalMarkets)}
                    centerSub="MARKETS"
                  />
                </div>
                <div className="admin-legend" style={{ flex: 1, minWidth: 130 }}>
                  {allocation.map((a) => (
                    <div className="admin-legend__row" key={a.label}>
                      <span className="admin-legend__dot" style={{ background: a.color }} />
                      <span className="admin-legend__nm">{a.label}</span>
                      <span className="admin-legend__val">{a.pct}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="admin-empty" style={{ width: "100%" }}>
                <Icon name="coins" size={34} />
                <div>No market volume yet.</div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="admin-grid admin-cols-3" style={{ marginTop: 16 }}>
        <Card
          title="Top markets by volume"
          action={
            <Link className="admin-btn admin-btn--sm admin-btn--subtle" href="/admin/markets">
              View all
            </Link>
          }
          noBody
        >
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th className="admin-num-right">Ref. price</th>
                  <th className="admin-num-right">Trades</th>
                  <th style={{ textAlign: "right" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {topMarkets.map((m) => (
                  <tr key={m.symbol}>
                    <td>
                      <div className="admin-cell-user">
                        <span
                          className="admin-avatar"
                          style={{ background: avatarColor(m.symbol), width: 28, height: 28, fontSize: 10 }}
                        >
                          {m.symbol.slice(0, 3)}
                        </span>
                        <div>
                          <div className="admin-cell-strong">{m.symbol}/USD</div>
                          <div className="admin-cell-sub">{m.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num admin-num-right">{m.price.toFixed(5)}</td>
                    <td className="num admin-num-right">{num(m.trades)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`admin-pill admin-pill--${m.isOpen ? "pos" : "warn"}`}>
                        {m.isOpen ? "Open" : "Paused"}
                      </span>
                    </td>
                  </tr>
                ))}
                {topMarkets.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="admin-empty">
                        <Icon name="coins" size={34} />
                        <div>No markets configured.</div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Recent activity"
          action={
            <Link className="admin-btn admin-btn--sm admin-btn--subtle" href="/admin/audit">
              Full log
            </Link>
          }
        >
          <div className="admin-feed">
            {recentAudit.map((a) => (
              <div className="admin-feed__item" key={a.id}>
                <div className="admin-feed__dot">
                  <Icon name={AUDIT_ICON[a.targetType.toLowerCase()] ?? "activity"} size={15} />
                </div>
                <div className="admin-feed__main">
                  <div className="admin-feed__txt">
                    <b>{a.actorId ?? "system"}</b> {a.action.replace(/[._]/g, " ")}
                  </div>
                  <div className="admin-feed__meta">
                    {timeAgo(a.createdAt)} &middot; {a.targetType}
                  </div>
                </div>
              </div>
            ))}
            {recentAudit.length === 0 ? (
              <div className="admin-empty">
                <Icon name="scroll" size={34} />
                <div>No audited actions yet.</div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
