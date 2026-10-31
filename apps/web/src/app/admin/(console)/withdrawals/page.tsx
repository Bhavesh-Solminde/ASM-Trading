import Link from "next/link";
import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, EmptyRow, PageHead, Pager, StatusPill, TabBar } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { PAYOUT_METHOD_LABEL, USDT_NETWORK_INFO, isUsdtNetwork } from "@asm/contracts";
import { hrefWith, fmtDate, moneyFromMinor, timeAgo } from "../../_lib/format";
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
  return moneyFromMinor(minor, currency);
}

function userName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email.split("@")[0]!;
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
      where: { status: "REQUESTED", ...EXCLUDE_AFFILIATE },
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
  const owedRounded = owedLabel.replace(/\.00\b/g, "");

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

  const tabHref = (key: Tab) => hrefWith(PATH, sp, { tab: key === "pending" ? null : key, page: null, q: null });
  const desc =
    tab === "pending"
      ? pendingCount
        ? `${pendingCount} to approve · ${owedRounded}. Check the payee against the KYC name. Approving moves it to To pay; rejecting refunds the balance.`
        : "Nothing to approve. Check the payee against the KYC name before approving."
      : tab === "approved"
        ? "Send the money to the details shown, then mark it paid. If the payment fails, reject to refund the user."
        : tab === "held"
          ? "Funds are already debited. Each one moves to To approve when its hold ends."
          : "Paid, cancelled and rejected requests.";

  return (
    <>
      <PageHead title="Withdrawals" desc={desc} />

      <section className="admin-card">
        <TabBar
          label="Withdrawal views"
          active={tab}
          tabs={[
            { key: "pending", label: "To approve", href: tabHref("pending"), count: pendingCount },
            { key: "approved", label: "To pay", href: tabHref("approved"), count: approvedCount },
            { key: "held", label: "On hold", href: tabHref("held"), count: heldCount },
            { key: "history", label: "History", href: tabHref("history") },
          ]}
        />

        <div className="admin-toolbar">
          <TableControls placeholder="Search UPI ID, account no., wallet or email" />
          <span className="admin-result-count">{tab === "history" ? "Newest first" : "Oldest first"}</span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <th>User</th>
                <th className="admin-num-right">Amount</th>
                <th>Pay to</th>
                <th>Funded via</th>
                <th>{tab === "pending" ? "Waiting" : tab === "held" ? "Held" : tab === "approved" ? "Requested" : "Created"}</th>
                {tab === "held" ? <th>Releases in</th> : null}
                {tab === "history" ? <th>Status</th> : null}
                <th className="admin-num-right">
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                    Actions
                  </span>
                </th>
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
                        ? "Nothing to approve. The queue is clear."
                        : tab === "approved"
                          ? "Nothing approved and waiting to be paid."
                          : tab === "held"
                            ? "No withdrawals on hold."
                            : "No withdrawal history yet."
                  }
                />
              ) : (
                rows.map((w) => {
                  const name = userName(w.user);
                  const verified = w.user.kycStatus === "VERIFIED";
                  return (
                    <tr key={w.id}>
                      <td>
                        <div className="admin-cell-user">
                          <Avatar name={name} size={32} />
                          <div>
                            <div className="admin-cell-strong" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {name}
                              {verified ? <span className="admin-pill admin-pill--pos">KYC</span> : null}
                            </div>
                            <div className="admin-cell-sub">{w.user.email}</div>
                            {!verified && tab !== "history" ? (
                              <span className="admin-kyc-warn">
                                <Icon name="alert" size={13} />
                                {w.user.kycStatus === "PENDING" ? "KYC still pending" : "KYC not verified"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="admin-num-right admin-amount">{money(w.amount, w.currency)}</td>
                      <td style={{ minWidth: 220 }}>
                        <PayoutCell w={w} />
                        {sharedWithOthers(w.userId, w.destinationKey) ? (
                          <span className="admin-kyc-warn" style={{ color: "var(--admin-neg)" }}>
                            <Icon name="alert" size={13} />
                            Also used by another account
                          </span>
                        ) : null}
                      </td>
                      <td className="admin-cell-sub" style={{ color: "var(--admin-muted)" }}>
                        {(depositsByUser.get(w.userId) ?? ["No completed deposit"]).join(", ")}
                      </td>
                      <td>
                        {tab === "pending" || tab === "held" ? (
                          <span className={`admin-age${Date.now() - w.createdAt.getTime() >= 12 * 3600_000 ? " hot" : ""}`}>
                            {timeAgo(w.createdAt).replace(" ago", "")}
                          </span>
                        ) : (
                          <span className="admin-age">{fmtDate(w.createdAt)}</span>
                        )}
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
                          <div className="admin-row-actions">
                            <RejectForm id={w.id} />
                            <form action={approveWithdrawalAction}>
                              <input type="hidden" name="withdrawalId" value={w.id} />
                              <button type="submit" className="admin-btn admin-btn--sm admin-btn--pos">
                                Approve
                              </button>
                            </form>
                          </div>
                        ) : tab === "approved" ? (
                          <div className="admin-row-actions">
                            <RejectForm id={w.id} />
                            <form action={markWithdrawalPaidAction}>
                              <input type="hidden" name="withdrawalId" value={w.id} />
                              <button type="submit" className="admin-btn admin-btn--sm admin-btn--pos">
                                Mark paid
                              </button>
                            </form>
                          </div>
                        ) : tab === "held" ? (
                          <div className="admin-row-actions">
                            <RejectForm id={w.id} />
                            <form action={releaseHeldWithdrawalAction}>
                              <input type="hidden" name="withdrawalId" value={w.id} />
                              <button type="submit" className="admin-btn admin-btn--sm admin-btn--ghost">
                                Release now
                              </button>
                            </form>
                          </div>
                        ) : (
                          <Link className="admin-link" href={`/admin/users?q=${encodeURIComponent(w.user.email)}`} style={{ fontSize: 13 }}>
                            View user
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

        <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
      </section>
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
        <span className="mono" style={{ userSelect: "all" }}>
          {v}
        </span>
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
    <details className="admin-reject">
      <summary className="admin-btn admin-btn--sm admin-btn--danger">Reject</summary>
      <form action={rejectWithdrawalAction} className="admin-reject__panel">
        <input type="hidden" name="withdrawalId" value={id} />
        <label className="admin-label" htmlFor={`reason-${id}`}>
          Reason shown to the user
        </label>
        <select
          id={`reason-${id}`}
          name="reason"
          className="admin-select"
          defaultValue={WITHDRAWAL_REJECT_REASONS[0]}
        >
          {WITHDRAWAL_REJECT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit" className="admin-btn admin-btn--sm admin-btn--danger">
          Reject and refund
        </button>
      </form>
    </details>
  );
}
