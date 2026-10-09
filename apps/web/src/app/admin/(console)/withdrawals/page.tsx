import Link from "next/link";
import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, Card, EmptyRow, Pager, StatCard, StatusPill } from "../../_components/ui";
import { PAYOUT_METHOD_LABEL, USDT_NETWORK_INFO, isUsdtNetwork } from "@asm/contracts";
import { hrefWith, fmtDate, inrFromMinor, timeAgo, usdFromMinor } from "../../_lib/format";
import {
  approveWithdrawalAction,
  markWithdrawalPaidAction,
  rejectWithdrawalAction,
  releaseHeldWithdrawalAction,
} from "./actions";
import { WITHDRAWAL_REJECT_REASONS } from "./reasons";

export const dynamic = "force-dynamic";

const PATH = "/admin/withdrawals";
const PER_PAGE = 20;
type Tab = "pending" | "approved" | "held" | "history";

function money(minor: number, currency: string): string {
  return currency === "INR" ? inrFromMinor(minor) : usdFromMinor(minor);
}

function userName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email.split("@")[0]!;
}

function TabBar({
  tab,
  sp,
  pendingCount,
  approvedCount,
  heldCount,
}: {
  tab: Tab;
  sp: Record<string, string | undefined>;
  pendingCount: number;
  approvedCount: number;
  heldCount: number;
}) {
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "pending", label: "Pending", ...(pendingCount ? { badge: pendingCount } : {}) },
    { key: "approved", label: "To pay", ...(approvedCount ? { badge: approvedCount } : {}) },
    { key: "held", label: "On Hold", ...(heldCount ? { badge: heldCount } : {}) },
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

/**
 * Live countdown of time remaining until the hold auto-promotes. Rendered as
 * a server-rendered absolute label — a 60s refresh via `force-dynamic` keeps
 * it fresh enough for the admin console (no need for a 1s client ticker).
 */
function HoldUntilLabel({ holdUntil }: { holdUntil: Date | null }) {
  if (!holdUntil) return <span className="admin-cell-sub">—</span>;
  const ms = holdUntil.getTime() - Date.now();
  if (ms <= 0) return <span className="admin-cell-sub">now</span>;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return (
    <span className="admin-cell-sub mono tabular-nums">
      {h}h {m}m
    </span>
  );
}

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const tab: Tab =
    sp.tab === "history"
      ? "history"
      : sp.tab === "held"
        ? "held"
        : sp.tab === "approved"
          ? "approved"
          : "pending";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  // Hide affiliate-owned withdrawals from every admin counter and listing —
  // affiliate withdrawals render in the user's own history but are never
  // debited, approved, or paid. Applied uniformly across pending / held /
  // history so no screen leaks a non-actionable row. See affiliate design doc.
  const EXCLUDE_AFFILIATE: Prisma.WithdrawalWhereInput = {
    user: { role: { not: "AFFILIATE" } },
  };

  const [pendingCount, approvedCount, owedByCurrency, heldCount] = await Promise.all([
    prisma.withdrawal.count({
      where: { status: "REQUESTED", ...EXCLUDE_AFFILIATE },
    }),
    prisma.withdrawal.count({
      where: { status: "APPROVED", ...EXCLUDE_AFFILIATE },
    }),
    // Amounts are in each row's own currency, so the total is per currency.
    prisma.withdrawal.groupBy({
      by: ["currency"],
      where: { status: { in: ["REQUESTED", "APPROVED"] }, ...EXCLUDE_AFFILIATE },
      _sum: { amount: true },
    }),
    prisma.withdrawal.count({
      where: { status: "HELD", ...EXCLUDE_AFFILIATE },
    }),
  ]);
  const owedLabel =
    owedByCurrency
      .filter((g) => (g._sum.amount ?? 0) > 0)
      .map((g) => money(g._sum.amount ?? 0, g.currency))
      .join(" + ") || money(0, "INR");

  const statusFilter: Prisma.WithdrawalWhereInput =
    tab === "pending"
      ? { status: "REQUESTED", ...EXCLUDE_AFFILIATE }
      : tab === "approved"
        ? { status: "APPROVED", ...EXCLUDE_AFFILIATE }
      : tab === "held"
        ? { status: "HELD", ...EXCLUDE_AFFILIATE }
        : {
            status: { in: ["REJECTED", "PAID", "CANCELLED_BY_USER"] },
            ...EXCLUDE_AFFILIATE,
          };

  const where: Prisma.WithdrawalWhereInput = q
    ? {
        AND: [
          statusFilter,
          {
            OR: [
              { method: { contains: q, mode: "insensitive" } },
              { upiId: { contains: q, mode: "insensitive" } },
              { accountNumber: { contains: q } },
              { usdtAddress: { contains: q, mode: "insensitive" } },
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
      orderBy: tab === "pending" || tab === "approved" ? { createdAt: "asc" } : { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        user: { select: { email: true, firstName: true, lastName: true, kycStatus: true } },
      },
    }),
  ]);

  // How each user on this page deposited (completed deposits only), so the
  // operator can compare it with where they want to be paid.
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const keys = [...new Set(rows.map((r) => r.destinationKey).filter((k): k is string => !!k))];
  const [depositGroups, sameDestination] = await Promise.all([
    userIds.length
      ? prisma.deposit.groupBy({
          by: ["userId", "method", "network"],
          where: { userId: { in: userIds }, status: "COMPLETED" },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    keys.length
      ? prisma.withdrawal.findMany({
          where: { destinationKey: { in: keys } },
          select: { userId: true, destinationKey: true },
          distinct: ["userId", "destinationKey"],
        })
      : Promise.resolve([]),
  ]);
  const depositsByUser = new Map<string, string[]>();
  for (const g of depositGroups) {
    const label =
      g.method === "USDT" && isUsdtNetwork(g.network)
        ? `USDT ${USDT_NETWORK_INFO[g.network].standard}`
        : g.method;
    const list = depositsByUser.get(g.userId) ?? [];
    list.push(`${label} ×${g._count._all}`);
    depositsByUser.set(g.userId, list);
  }
  function sharedWithOthers(userId: string, key: string | null): boolean {
    return !!key && sameDestination.some((d) => d.destinationKey === key && d.userId !== userId);
  }

  const spForLinks: Record<string, string | undefined> = {
    tab: tab === "pending" ? undefined : tab,
    q: q || undefined,
  };

  return (
    <>
      <div className="admin-grid admin-stat-grid" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
        <StatCard
          label="Withdrawals to handle"
          value={String(pendingCount + approvedCount)}
          icon="dollar"
          warn={pendingCount + approvedCount > 0}
          foot={<span>{owedLabel} pending payout</span>}
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
          title={
            tab === "pending"
              ? "Withdrawals awaiting approval"
              : tab === "approved"
                ? "Approved — send the money, then mark paid"
              : tab === "held"
                ? "Withdrawals on hold"
                : "Withdrawal history"
          }
          sub={
            tab === "pending"
              ? "Check the payout details against the KYC name. Approve to move it to To pay; reject refunds the balance."
              : tab === "approved"
                ? "Pay to the details shown, then Mark paid. If the payment fails, reject to refund the user."
              : tab === "held"
                ? "Funds already debited; auto-promotes to Pending at the hold expiry."
                : "Paid, cancelled and rejected requests."
          }
          noBody
        >
          <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
            <TabBar
              tab={tab}
              sp={sp}
              pendingCount={pendingCount}
              approvedCount={approvedCount}
              heldCount={heldCount}
            />
          </div>

          <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
            <TableControls placeholder="Search UPI ID, account no., wallet, email or name…" />
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th className="admin-num-right">Amount</th>
                  <th>Pay to</th>
                  <th>Deposited via</th>
                  <th>
                    {tab === "pending" ? "Requested" : tab === "held" ? "Held" : "Created"}
                  </th>
                  {tab === "held" ? <th>Releases in</th> : null}
                  {tab === "history" ? <th>Status</th> : null}
                  <th className="admin-num-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <EmptyRow
                    cols={tab === "held" || tab === "history" ? 7 : 6}
                    message={
                      q
                        ? "No withdrawals match that search."
                        : tab === "pending"
                          ? "No withdrawals awaiting approval."
                          : tab === "approved"
                            ? "Nothing approved and waiting to be paid."
                          : tab === "held"
                            ? "No withdrawals currently on hold."
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
                              <div className="admin-cell-sub" style={{ marginTop: 2 }}>
                                KYC <StatusPill status={w.user.kycStatus} />
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="num admin-num-right admin-cell-strong">{money(w.amount, w.currency)}</td>
                        <td style={{ fontSize: 12, minWidth: 200 }}>
                          <PayoutCell w={w} />
                          {sharedWithOthers(w.userId, w.destinationKey) ? (
                            <div style={{ color: "var(--admin-neg, #c0392b)", fontWeight: 600, marginTop: 4 }}>
                              ⚠ Also used by another account
                            </div>
                          ) : null}
                        </td>
                        <td className="admin-cell-sub" style={{ fontSize: 12 }}>
                          {(depositsByUser.get(w.userId) ?? ["No completed deposit"]).join(", ")}
                        </td>
                        <td className="admin-cell-sub">
                          {tab === "pending" || tab === "held"
                            ? timeAgo(w.createdAt)
                            : fmtDate(w.createdAt)}
                        </td>
                        {tab === "held" ? (
                          <td>
                            <HoldUntilLabel holdUntil={w.holdUntil} />
                          </td>
                        ) : null}
                        {tab === "history" ? (
                          <td>
                            <StatusPill status={w.status} />
                          </td>
                        ) : null}
                        <td className="admin-num-right">
                          {tab === "pending" ? (
                            <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                              <form action={approveWithdrawalAction}>
                                <input type="hidden" name="withdrawalId" value={w.id} />
                                <button type="submit" className="admin-btn admin-btn--sm admin-btn--pos">
                                  Approve
                                </button>
                              </form>
                              <RejectForm id={w.id} />
                            </div>
                          ) : tab === "approved" ? (
                            <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                              <form action={markWithdrawalPaidAction}>
                                <input type="hidden" name="withdrawalId" value={w.id} />
                                <button type="submit" className="admin-btn admin-btn--sm admin-btn--pos">
                                  Mark paid
                                </button>
                              </form>
                              <RejectForm id={w.id} />
                            </div>
                          ) : tab === "held" ? (
                            <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                              <form action={releaseHeldWithdrawalAction}>
                                <input type="hidden" name="withdrawalId" value={w.id} />
                                <button type="submit" className="admin-btn admin-btn--sm">
                                  Force-release now
                                </button>
                              </form>
                              <RejectForm id={w.id} />
                            </div>
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

type PayoutRow = {
  method: string;
  accountHolder: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  usdtNetwork: string | null;
  usdtAddress: string | null;
  reason: string | null;
  status: string;
};

/** Full payout details for the operator to pay to (rows before 2026-10-09 carry only a method label). */
function PayoutCell({ w }: { w: PayoutRow }) {
  const label = PAYOUT_METHOD_LABEL[w.method as keyof typeof PAYOUT_METHOD_LABEL] ?? w.method;
  const line = (k: string, v: string | null) =>
    v ? (
      <div>
        <span className="admin-cell-sub">{k} </span>
        <span className="mono" style={{ userSelect: "all" }}>{v}</span>
      </div>
    ) : null;
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div className="admin-cell-strong">{label}</div>
      {w.method === "BANK" ? (
        <>
          {line("Name", w.accountHolder)}
          {line("A/c", w.accountNumber)}
          {line("IFSC", w.ifsc)}
        </>
      ) : null}
      {w.method === "UPI" ? line("UPI", w.upiId) : null}
      {w.method === "USDT" ? (
        <>
          {line("Net", isUsdtNetwork(w.usdtNetwork) ? USDT_NETWORK_INFO[w.usdtNetwork].shortLabel : w.usdtNetwork)}
          <div className="mono" style={{ userSelect: "all", wordBreak: "break-all" }}>{w.usdtAddress}</div>
        </>
      ) : null}
      {w.status === "REJECTED" && w.reason ? (
        <div className="admin-cell-sub">Rejected: {w.reason}</div>
      ) : null}
    </div>
  );
}

/** Reject with a preset reason (the user sees it); refunds the amount. */
function RejectForm({ id }: { id: string }) {
  return (
    <details>
      <summary className="admin-cell-sub" style={{ cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>
        Reject…
      </summary>
      <form action={rejectWithdrawalAction} style={{ display: "grid", gap: 6, marginTop: 6, minWidth: 220 }}>
        <input type="hidden" name="withdrawalId" value={id} />
        <select name="reason" className="admin-select" defaultValue={WITHDRAWAL_REJECT_REASONS[0]} aria-label="Reject reason">
          {WITHDRAWAL_REJECT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit" className="admin-btn admin-btn--sm admin-btn--danger">
          Reject &amp; refund
        </button>
      </form>
    </details>
  );
}
