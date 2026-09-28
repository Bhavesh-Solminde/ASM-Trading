import Link from "next/link";
import {
  countUsdtReviewQueue,
  getUsdtReviewEvidence,
  listCandidateDepositsForChainCredit,
  listOrphanBankCredits,
  listUsdtReviewQueue,
  prisma,
  type ChainCredit,
  type Prisma,
} from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, Card, EmptyRow, Pager, StatCard, StatusPill } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { hrefWith, fmtDate, fmtDateTime, inrFromMinor, timeAgo, usdCompactFromMinor, usdFromMinor } from "../../_lib/format";
import { approveDepositAction, rejectDepositAction, reverseUsdtDepositAction } from "./actions";
import {
  EMPTY_EVIDENCE,
  isCreditable,
  UsdtResultBanner,
  UsdtReviewTable,
  usdtFromMinor,
  usdtNetworkLabel,
  type CandidateDeposit,
  type ReviewEvidence,
  type UsdtReviewRow,
} from "./_components/UsdtReview";

export const dynamic = "force-dynamic";

const PATH = "/admin/deposits";
const PER_PAGE = 20;
const USDT_QUEUE_LIMIT = 50;
type Tab = "pending" | "history" | "usdt";

function userName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email.split("@")[0]!;
}

function TabBar({
  tab,
  sp,
  pendingCount,
  usdtReviewCount,
}: {
  tab: Tab;
  sp: Record<string, string | undefined>;
  pendingCount: number;
  usdtReviewCount: number;
}) {
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "pending", label: "Pending", ...(pendingCount ? { badge: pendingCount } : {}) },
    { key: "history", label: "History" },
    { key: "usdt", label: "USDT review", ...(usdtReviewCount > 0 ? { badge: usdtReviewCount } : {}) },
  ];
  return (
    <div className="admin-tabbar" role="tablist" aria-label="Deposit sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          href={hrefWith(PATH, sp, {
            tab: t.key === "pending" ? null : t.key,
            page: null,
            q: null,
            ok: null,
            error: null,
          })}
          className={`admin-tab${tab === t.key ? " active" : ""}`}
        >
          {t.label}
          {t.badge ? <span className="admin-tab__badge">{t.badge}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const tab: Tab = sp.tab === "history" ? "history" : sp.tab === "usdt" ? "usdt" : "pending";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [pendingCount, pendingAgg, usdtReviewCount] = await Promise.all([
    prisma.deposit.count({ where: { status: "PENDING_CONFIRMATION" } }),
    prisma.deposit.aggregate({
      where: { status: "PENDING_CONFIRMATION" },
      _sum: { amountUsd: true },
    }),
    countUsdtReviewQueue(),
  ]);

  const orphans = tab === "pending" ? await listOrphanBankCredits(10) : [];

  const statGrid = (
    <div className="admin-grid admin-stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
      <StatCard
        label="Deposits in review"
        value={String(pendingCount)}
        icon="inbox"
        warn={pendingCount > 0}
        foot={<span>{usdCompactFromMinor(pendingAgg._sum.amountUsd ?? 0)} awaiting vouch</span>}
      />
      <StatCard
        label="Withdrawals"
        value=""
        icon="dollar"
        foot={
          <Link href="/admin/withdrawals" style={{ color: "var(--admin-accent)" }}>
            Manage payouts &rarr;
          </Link>
        }
      />
      <StatCard
        label={tab === "pending" ? "Orphaned credits" : "USDT payments in review"}
        value={String(tab === "pending" ? orphans.length : usdtReviewCount)}
        icon="shield"
        warn={usdtReviewCount > 0 || orphans.length > 0}
        foot={
          tab === "pending" ? (
            usdtReviewCount > 0 ? (
              <span>
                need manual matching ·{" "}
                <Link href={`${PATH}?tab=usdt`} style={{ color: "var(--admin-accent)" }}>
                  {usdtReviewCount} USDT in review &rarr;
                </Link>
              </span>
            ) : (
              <span>need manual matching</span>
            )
          ) : (
            <span>on-chain payments needing an operator</span>
          )
        }
      />
    </div>
  );

  if (tab === "usdt") {
    const queue = await listUsdtReviewQueue(USDT_QUEUE_LIMIT);
    const [evidenceById, candidatesPerRow] = await Promise.all([
      // One batched lookup for the whole queue: tx-hash claims + known sending wallets.
      queue.length > 0
        ? getUsdtReviewEvidence(queue.map((c: ChainCredit) => c.id))
        : Promise.resolve({} as Record<string, ReviewEvidence>),
      Promise.all(
        queue.map(async (credit: ChainCredit) =>
          // Candidates only matter where the credit form is offered at all.
          isCreditable(credit)
            ? ((await listCandidateDepositsForChainCredit(credit.id)) as CandidateDeposit[])
            : [],
        ),
      ),
    ]);
    const usdtRows: UsdtReviewRow[] = queue.map((credit: ChainCredit, i: number) => ({
      credit,
      candidates: candidatesPerRow[i] ?? [],
      evidence: evidenceById[credit.id] ?? EMPTY_EVIDENCE,
    }));

    return (
      <>
        {statGrid}
        <div style={{ marginTop: 16 }}>
          <Card
            title="On-chain USDT payments needing review"
            sub="Transfers the matcher could not auto-credit. Crediting always adds the amount actually received on-chain."
            noBody
          >
            <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
              <TabBar tab={tab} sp={sp} pendingCount={pendingCount} usdtReviewCount={usdtReviewCount} />
            </div>
            {sp.ok || sp.error ? (
              <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
                <UsdtResultBanner ok={sp.ok} error={sp.error} />
              </div>
            ) : null}
            <UsdtReviewTable rows={usdtRows} />
            {usdtReviewCount > usdtRows.length ? (
              <div className="admin-cell-sub" style={{ padding: 12, fontSize: 12 }}>
                Showing the newest {usdtRows.length} of {usdtReviewCount}.
              </div>
            ) : null}
          </Card>
        </div>
      </>
    );
  }

  const statusFilter: Prisma.DepositWhereInput =
    tab === "pending"
      ? { status: "PENDING_CONFIRMATION" }
      : { status: { in: ["COMPLETED", "REJECTED", "EXPIRED"] } };

  const where: Prisma.DepositWhereInput = q
    ? {
        AND: [
          statusFilter,
          {
            OR: [
              { claimedUtr: { contains: q, mode: "insensitive" } },
              { user: { email: { contains: q, mode: "insensitive" } } },
              { user: { firstName: { contains: q, mode: "insensitive" } } },
              { user: { lastName: { contains: q, mode: "insensitive" } } },
            ],
          },
        ],
      }
    : statusFilter;

  const [total, rows] = await Promise.all([
    prisma.deposit.count({ where }),
    prisma.deposit.findMany({
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
      {statGrid}

      <div style={{ marginTop: 16 }}>
        <Card
          title={tab === "pending" ? "Deposits awaiting review" : "Deposit history"}
          sub={
            tab === "pending"
              ? "Only the residue reaches here — exact and amount-only matches settle automatically."
              : "Completed, rejected and expired deposits."
          }
          noBody
        >
          <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
            <TabBar tab={tab} sp={sp} pendingCount={pendingCount} usdtReviewCount={usdtReviewCount} />
          </div>

          {sp.ok || sp.error ? (
            <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
              <UsdtResultBanner ok={sp.ok} error={sp.error} />
            </div>
          ) : null}

          <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
            <TableControls placeholder="Search UTR, user email or name…" />
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th className="admin-num-right">Amount (USD)</th>
                  <th className="admin-num-right">Amount (INR)</th>
                  <th>Method</th>
                  <th>UTR</th>
                  {tab === "pending" ? <th>Screenshot</th> : null}
                  <th>{tab === "pending" ? "Requested" : "Resolved"}</th>
                  {tab === "history" ? <th>Status</th> : null}
                  <th className="admin-num-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <EmptyRow
                    cols={tab === "pending" ? 8 : 8}
                    message={
                      q
                        ? "No deposits match that search."
                        : tab === "pending"
                          ? "Nothing awaiting review. The queue is clear."
                          : "No deposit history yet."
                    }
                  />
                ) : (
                  rows.map((d) => {
                    const name = userName(d.user);
                    return (
                      <tr key={d.id}>
                        <td>
                          <div className="admin-cell-user">
                            <Avatar name={name} size={26} />
                            <div>
                              <div className="admin-cell-strong">{name}</div>
                              <div className="admin-cell-sub">{d.user.email}</div>
                            </div>
                          </div>
                        </td>
                        {/* USDT deposits carry a negative sentinel in amountInr and 0 in
                            amountUsd — their real amount lives in amountUsdtMinor. */}
                        <td className="num admin-num-right admin-cell-strong">
                          {d.method === "USDT" ? usdtFromMinor(d.amountUsdtMinor) : usdFromMinor(d.amountUsd)}
                          {d.method === "USDT" ? (
                            <div className="admin-cell-sub" style={{ fontSize: 11, fontWeight: 400 }}>
                              on {usdtNetworkLabel(d.network)}
                            </div>
                          ) : null}
                        </td>
                        <td className="num admin-num-right admin-cell-sub">
                          {d.method === "USDT" ? "—" : inrFromMinor(d.amountInr)}
                        </td>
                        <td>{d.method}</td>
                        <td className="mono admin-cell-sub" style={{ fontSize: 12 }}>
                          {d.claimedUtr ?? "—"}
                        </td>
                        {tab === "pending" ? (
                          <td>
                            {d.screenshotUrl ? (
                              <a
                                href={d.screenshotUrl}
                                target="_blank"
                                rel="noreferrer"
                                title="Open the payment screenshot"
                                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                              >
                                <img
                                  src={d.screenshotUrl}
                                  alt=""
                                  width={30}
                                  height={30}
                                  style={{ objectFit: "cover", borderRadius: 3, border: "1px solid var(--admin-border)" }}
                                />
                                <span className="admin-cell-sub" style={{ fontSize: 11 }}>view</span>
                              </a>
                            ) : (
                              <span className="admin-cell-sub" style={{ fontSize: 11, opacity: 0.6 }}>none</span>
                            )}
                          </td>
                        ) : null}
                        <td className="admin-cell-sub">
                          {tab === "pending" ? timeAgo(d.createdAt) : fmtDate(d.updatedAt)}
                        </td>
                        {tab === "history" ? (
                          <td>
                            <StatusPill status={d.status} />
                          </td>
                        ) : null}
                        <td className="admin-num-right">
                          {tab === "pending" ? (
                            <div style={{ display: "inline-flex", gap: 6 }}>
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
                          ) : d.method === "USDT" && d.status === "COMPLETED" ? (
                            <div style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                              <Link
                                href={`/admin/users?q=${encodeURIComponent(d.user.email)}`}
                                className="admin-cell-sub"
                                style={{ fontSize: 11, textDecoration: "underline" }}
                              >
                                user
                              </Link>
                              <form
                                action={reverseUsdtDepositAction}
                                style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}
                              >
                                <input type="hidden" name="depositId" value={d.id} />
                                <input
                                  type="text"
                                  name="reason"
                                  required
                                  placeholder="Reason (e.g. wrong user)"
                                  className="admin-input"
                                  style={{ width: 180, fontSize: 12, padding: "4px 6px" }}
                                />
                                <label
                                  className="admin-cell-sub"
                                  style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
                                  title="Reclaim the credit even if the user's balance is now below it (caps at zero instead of refusing)."
                                >
                                  <input type="checkbox" name="force" />
                                  Force if balance is short
                                </label>
                                <button
                                  type="submit"
                                  className="admin-btn admin-btn--sm admin-btn--danger"
                                  title="Undo this credit and return the on-chain payment to the USDT review queue."
                                >
                                  Reverse &amp; requeue
                                </button>
                              </form>
                            </div>
                          ) : (
                            <Link
                              href={`/admin/users?q=${encodeURIComponent(d.user.email)}`}
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

      {tab === "pending" && orphans.length > 0 ? (
        <div style={{ marginTop: 16 }}>
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
                  {orphans.map((c) => (
                    <tr key={c.id}>
                      <td className="admin-cell-sub">{fmtDateTime(c.receivedAt)}</td>
                      <td className="num admin-num-right">{inrFromMinor(c.amountInr)}</td>
                      <td className="mono admin-cell-sub">{c.utr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
