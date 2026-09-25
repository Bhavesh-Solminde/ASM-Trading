import Link from "next/link";
import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, Card, EmptyRow, Pager, StatCard, StatusPill } from "../../_components/ui";
import { hrefWith, fmtDate, timeAgo, usdCompactFromMinor, usdFromMinor } from "../../_lib/format";
import { approveWithdrawalAction } from "./actions";

export const dynamic = "force-dynamic";

const PATH = "/admin/withdrawals";
const PER_PAGE = 20;
type Tab = "pending" | "history";

function userName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email.split("@")[0]!;
}

function TabBar({ tab, sp, pendingCount }: { tab: Tab; sp: Record<string, string | undefined>; pendingCount: number }) {
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "pending", label: "Pending", ...(pendingCount ? { badge: pendingCount } : {}) },
    { key: "history", label: "History" },
  ];
  return (
    <div className="admin-tabbar" role="tablist" aria-label="Withdrawal sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          href={hrefWith(PATH, sp, { tab: t.key === "pending" ? null : t.key, page: null, q: null })}
          className={`admin-tab${tab === t.key ? " active" : ""}`}
        >
          {t.label}
          {t.badge ? <span className="admin-tab__badge">{t.badge}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const tab: Tab = sp.tab === "history" ? "history" : "pending";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [pendingCount, pendingAgg] = await Promise.all([
    prisma.withdrawal.count({ where: { status: "REQUESTED" } }),
    prisma.withdrawal.aggregate({
      where: { status: "REQUESTED" },
      _sum: { amount: true },
    }),
  ]);

  const statusFilter: Prisma.WithdrawalWhereInput =
    tab === "pending"
      ? { status: "REQUESTED" }
      : { status: { in: ["APPROVED", "REJECTED", "PAID"] } };

  const where: Prisma.WithdrawalWhereInput = q
    ? {
        AND: [
          statusFilter,
          {
            OR: [
              { method: { contains: q, mode: "insensitive" } },
              { user: { email: { contains: q, mode: "insensitive" } } },
              { user: { firstName: { contains: q, mode: "insensitive" } } },
              { user: { lastName: { contains: q, mode: "insensitive" } } },
            ],
          },
        ],
      }
    : statusFilter;

  const [total, rows] = await Promise.all([
    prisma.withdrawal.count({ where }),
    prisma.withdrawal.findMany({
      where,
      orderBy: tab === "pending" ? { createdAt: "asc" } : { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    }),
  ]);

  const spForLinks: Record<string, string | undefined> = {
    tab: tab === "pending" ? undefined : tab,
    q: q || undefined,
  };

  return (
    <>
      <div className="admin-grid admin-stat-grid" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
        <StatCard
          label="Withdrawals requested"
          value={String(pendingCount)}
          icon="dollar"
          warn={pendingCount > 0}
          foot={<span>{usdCompactFromMinor(pendingAgg._sum.amount ?? 0)} to release</span>}
        />
        <StatCard
          label="Deposits"
          value=""
          icon="inbox"
          foot={
            <Link href="/admin/deposits" style={{ color: "var(--admin-accent)" }}>
              Review the deposit queue &rarr;
            </Link>
          }
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title={tab === "pending" ? "Withdrawals awaiting approval" : "Withdrawal history"}
          sub={
            tab === "pending"
              ? "Approving transitions the request to APPROVED for payout."
              : "Approved, paid and rejected requests."
          }
          noBody
        >
          <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
            <TabBar tab={tab} sp={sp} pendingCount={pendingCount} />
          </div>

          <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
            <TableControls placeholder="Search method, user email or name…" />
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th className="admin-num-right">Amount (USD)</th>
                  <th>Method</th>
                  <th>{tab === "pending" ? "Requested" : "Created"}</th>
                  {tab === "history" ? <th>Status</th> : null}
                  <th className="admin-num-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <EmptyRow
                    cols={tab === "pending" ? 5 : 6}
                    message={
                      q
                        ? "No withdrawals match that search."
                        : tab === "pending"
                          ? "No withdrawals awaiting approval."
                          : "No withdrawal history yet."
                    }
                  />
                ) : (
                  rows.map((w) => {
                    const name = userName(w.user);
                    return (
                      <tr key={w.id}>
                        <td>
                          <div className="admin-cell-user">
                            <Avatar name={name} size={26} />
                            <div>
                              <div className="admin-cell-strong">{name}</div>
                              <div className="admin-cell-sub">{w.user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num admin-num-right admin-cell-strong">{usdFromMinor(w.amount)}</td>
                        <td className="mono admin-cell-sub" style={{ fontSize: 12 }}>
                          {w.method}
                        </td>
                        <td className="admin-cell-sub">
                          {tab === "pending" ? timeAgo(w.createdAt) : fmtDate(w.createdAt)}
                        </td>
                        {tab === "history" ? (
                          <td>
                            <StatusPill status={w.status} />
                          </td>
                        ) : null}
                        <td className="admin-num-right">
                          {tab === "pending" ? (
                            <form action={approveWithdrawalAction}>
                              <input type="hidden" name="withdrawalId" value={w.id} />
                              <button type="submit" className="admin-btn admin-btn--sm admin-btn--pos">
                                Approve payout
                              </button>
                            </form>
                          ) : (
                            <Link
                              href={`/admin/users?q=${encodeURIComponent(w.user.email)}`}
                              className="admin-cell-sub"
                              style={{ fontSize: 11, textDecoration: "underline" }}
                            >
                              user
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ padding: 12 }}>
            <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
          </div>
        </Card>
      </div>
    </>
  );
}
