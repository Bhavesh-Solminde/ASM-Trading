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
import { Avatar, EmptyRow, PageHead, Pager, StatusPill, TabBar, Tag } from "../../_components/ui";
import { hrefWith, fmtDate, fmtDateTime, inrFromMinor, timeAgo, usdFromMinor } from "../../_lib/format";
import { approveDepositAction, rejectDepositAction, reverseUsdtDepositAction } from "./actions";
import { CopyText } from "./_components/CopyText";
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
const ORPHAN_LIMIT = 50;
const HOUR = 3600_000;
type Tab = "pending" | "usdt" | "unmatched" | "history";

function userName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email.split("@")[0]!;
}

/** "1h", "46m" — how long a deposit has waited. An hour or more reads as overdue. */
function Waiting({ since }: { since: Date }) {
  const hot = Date.now() - since.getTime() >= HOUR;
  return <span className={`admin-age${hot ? " hot" : ""}`}>{timeAgo(since).replace(" ago", "")}</span>;
}

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const tab: Tab =
    sp.tab === "history" || sp.tab === "usdt" || sp.tab === "unmatched" ? sp.tab : "pending";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  // Affiliate accounts can submit a deposit form (SMS webhook will never match
  // it, matchers skip them), but operators should never see those rows: they
  // are not real money. Exclude role=AFFILIATE from every count, aggregate and
  // listing on this page.
  const notAffiliate: Prisma.DepositWhereInput = {
    user: { role: { not: "AFFILIATE" } },
  };

  const [pendingAgg, usdtReviewCount, orphanCount] = await Promise.all([
    prisma.deposit.aggregate({
      where: { AND: [{ status: "PENDING_CONFIRMATION" }, notAffiliate] },
      _count: { _all: true },
      _sum: { amountInr: true },
    }),
    countUsdtReviewQueue(),
    prisma.bankCredit.count({ where: { consumed: false } }),
  ]);
  const pendingCount = pendingAgg._count._all;

  const tabHref = (key: Tab) =>
    hrefWith(PATH, sp, { tab: key === "pending" ? null : key, page: null, q: null, ok: null, error: null });
  const tabs = (
    <TabBar
      label="Deposit views"
      active={tab}
      tabs={[
        { key: "pending", label: "Needs review", href: tabHref("pending"), count: pendingCount },
        { key: "usdt", label: "USDT review", href: tabHref("usdt"), count: usdtReviewCount },
        { key: "unmatched", label: "Unmatched credits", href: tabHref("unmatched"), count: orphanCount },
        { key: "history", label: "History", href: tabHref("history") },
      ]}
    />
  );
  const banner =
    sp.ok || sp.error ? (
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--admin-border)" }}>
        <UsdtResultBanner ok={sp.ok} error={sp.error} />
      </div>
    ) : null;

  const head = (
    <PageHead
      title="Deposits"
      desc={
        pendingCount
          ? `${pendingCount} waiting · ${inrFromMinor(pendingAgg._sum.amountInr ?? 0, 0)} to confirm. Exact UTR matches settle on their own; only the ones that didn't match land here.`
          : "Nothing waiting. Exact UTR matches settle on their own; only the ones that didn't match land here."
      }
    />
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
        {head}
        <section className="admin-card">
          {tabs}
          {banner}
          <div className="admin-cell-sub" style={{ padding: "12px 18px", borderBottom: "1px solid var(--admin-border)" }}>
            On-chain transfers the matcher couldn&rsquo;t credit on its own. Crediting always adds the amount actually
            received on-chain.
          </div>
          <UsdtReviewTable rows={usdtRows} />
          {usdtReviewCount > usdtRows.length ? (
            <div className="admin-pager">
              <span className="info">
                Showing the newest {usdtRows.length} of {usdtReviewCount}.
              </span>
            </div>
          ) : null}
        </section>
      </>
    );
  }

  if (tab === "unmatched") {
    const orphans = await listOrphanBankCredits(ORPHAN_LIMIT);
    return (
      <>
        {head}
        <section className="admin-card">
          {tabs}
          <div className="admin-cell-sub" style={{ padding: "12px 18px", borderBottom: "1px solid var(--admin-border)" }}>
            Money that reached the bank with no deposit to match it. Search the UTR to find the user who paid.
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th className="admin-num-right">Amount</th>
                  <th>UTR</th>
                  <th className="admin-num-right">
                    <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                      Find
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orphans.length === 0 ? (
                  <EmptyRow cols={4} message="Every bank credit is matched to a deposit." />
                ) : (
                  orphans.map((c) => (
                    <tr key={c.id}>
                      <td className="admin-cell-sub" style={{ color: "var(--admin-muted)" }}>
                        {fmtDateTime(c.receivedAt)}
                      </td>
                      <td className="admin-num-right admin-amount">{inrFromMinor(c.amountInr)}</td>
                      <td>
                        <CopyText value={c.utr} label="UTR" />
                      </td>
                      <td className="admin-num-right">
                        <Link className="admin-btn admin-btn--sm admin-btn--ghost" href={hrefWith(PATH, {}, { q: c.utr })}>
                          Search deposits
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {orphanCount > orphans.length ? (
            <div className="admin-pager">
              <span className="info">
                Showing the newest {orphans.length} of {orphanCount}.
              </span>
            </div>
          ) : null}
        </section>
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
          notAffiliate,
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
    : { AND: [statusFilter, notAffiliate] };

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
  const pending = tab === "pending";

  return (
    <>
      {head}

      <section className="admin-card">
        {tabs}
        {banner}

        <div className="admin-toolbar">
          <TableControls placeholder="Search UTR, name or email" />
          <span className="admin-result-count">{pending ? "Oldest first" : "Newest first"}</span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <th>User</th>
                <th className="admin-num-right">Amount</th>
                <th>Method</th>
                <th>UTR</th>
                {pending ? <th>Proof</th> : null}
                <th>{pending ? "Waiting" : "Resolved"}</th>
                {pending ? null : <th>Status</th>}
                <th className="admin-num-right">
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                    {pending ? "Decision" : "Actions"}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow
                  cols={7}
                  message={
                    q
                      ? "No deposits match that search."
                      : pending
                        ? "Nothing waiting. The queue is clear."
                        : "No deposit history yet."
                  }
                />
              ) : (
                rows.map((d) => {
                  const name = userName(d.user);
                  const usdt = d.method === "USDT";
                  return (
                    <tr key={d.id}>
                      <td>
                        <div className="admin-cell-user">
                          <Avatar name={name} size={32} />
                          <div>
                            <div className="admin-cell-strong">{name}</div>
                            <div className="admin-cell-sub">{d.user.email}</div>
                          </div>
                        </div>
                      </td>
                      {/* USDT deposits carry a negative sentinel in amountInr and 0 in
                          amountUsd — their real amount lives in amountUsdtMinor. */}
                      <td className="admin-num-right">
                        <div className="admin-amount">
                          {usdt ? usdtFromMinor(d.amountUsdtMinor) : inrFromMinor(d.amountInr)}
                        </div>
                        <div className="admin-cell-sub">
                          {usdt ? `on ${usdtNetworkLabel(d.network)}` : usdFromMinor(d.amountUsd)}
                        </div>
                      </td>
                      <td>
                        <Tag>{d.method}</Tag>
                      </td>
                      <td>
                        {d.claimedUtr ? <CopyText value={d.claimedUtr} label="UTR" /> : <span className="admin-cell-sub">—</span>}
                      </td>
                      {pending ? (
                        <td>
                          {d.screenshotUrl ? (
                            <a
                              href={d.screenshotUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="admin-link"
                              style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}
                            >
                              <img
                                src={d.screenshotUrl}
                                alt=""
                                width={28}
                                height={28}
                                style={{ objectFit: "cover", borderRadius: 4, border: "1px solid var(--admin-border)" }}
                              />
                              View
                            </a>
                          ) : (
                            <span className="admin-cell-sub">No screenshot</span>
                          )}
                        </td>
                      ) : null}
                      <td>
                        {pending ? <Waiting since={d.createdAt} /> : <span className="admin-age">{fmtDate(d.updatedAt)}</span>}
                      </td>
                      {pending ? null : (
                        <td>
                          <StatusPill status={d.status} />
                        </td>
                      )}
                      <td className="admin-num-right">
                        {pending ? (
                          <div className="admin-row-actions">
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
                        ) : usdt && d.status === "COMPLETED" ? (
                          <form
                            action={reverseUsdtDepositAction}
                            style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}
                          >
                            <input type="hidden" name="depositId" value={d.id} />
                            <input
                              type="text"
                              name="reason"
                              required
                              placeholder="Reason, e.g. wrong user"
                              aria-label="Reason for reversing this deposit"
                              className="admin-input"
                              style={{ width: 200, height: 30, fontSize: 12.5, padding: "0 8px" }}
                            />
                            <label
                              className="admin-cell-sub"
                              style={{ display: "flex", alignItems: "center", gap: 6 }}
                              title="Reclaim the credit even if the user's balance is now below it (caps at zero instead of refusing)."
                            >
                              <input type="checkbox" name="force" />
                              Force if the balance is short
                            </label>
                            <button
                              type="submit"
                              className="admin-btn admin-btn--sm admin-btn--danger"
                              title="Undo this credit and return the on-chain payment to the USDT review queue."
                            >
                              Reverse and re-queue
                            </button>
                          </form>
                        ) : (
                          <Link className="admin-link" href={`/admin/users?q=${encodeURIComponent(d.user.email)}`} style={{ fontSize: 13 }}>
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
