import Link from "next/link";
import { KYC_DOCUMENT_KINDS, prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, EmptyRow, PageHead, Pager, TabBar, Tag } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDate, hrefWith, timeAgo } from "../../_lib/format";

export const dynamic = "force-dynamic";

const PATH = "/admin/kyc";
const PER_PAGE = 20;
type Tab = "pending" | "verified" | "rejected";
const STATUS: Record<Tab, "PENDING" | "VERIFIED" | "REJECTED"> = {
  pending: "PENDING",
  verified: "VERIFIED",
  rejected: "REJECTED",
};

function userName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email.split("@")[0]!;
}

/** KYC queue: submissions waiting for a decision (oldest first), plus verified / rejected history. */
export default async function KycQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "verified" ? "verified" : sp.tab === "rejected" ? "rejected" : "pending";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  // Every submission is listed, affiliates included (tagged) — anyone who sees
  // "in review" on their verify page must be findable here.
  const base: Prisma.UserWhereInput = {};
  const [pending, verified, rejected] = await Promise.all(
    (["PENDING", "VERIFIED", "REJECTED"] as const).map((kycStatus) =>
      prisma.user.count({ where: { ...base, kycStatus } }),
    ),
  );
  const counts: Record<Tab, number> = { pending: pending!, verified: verified!, rejected: rejected! };

  const where: Prisma.UserWhereInput = {
    ...base,
    kycStatus: STATUS[tab],
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { pan: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy:
        tab === "pending"
          ? [{ kycSubmittedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }]
          : [{ updatedAt: "desc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        kycStatus: true,
        kycSubmittedAt: true,
        kycReviewNote: true,
        updatedAt: true,
        _count: { select: { kycDocuments: true } },
      },
    }),
  ]);

  const spForLinks: Record<string, string | undefined> = {
    tab: tab === "pending" ? undefined : tab,
    q: q || undefined,
  };
  const cols = tab === "rejected" ? 5 : 4;
  const tabHref = (key: Tab) => hrefWith(PATH, sp, { tab: key === "pending" ? null : key, page: null });
  const oldest = tab === "pending" && page === 1 && !q ? rows.find((r) => r.kycSubmittedAt)?.kycSubmittedAt : null;
  const first = tab === "pending" && !q ? rows[0] : undefined;
  const DAY = 86400_000;

  return (
    <>
      <PageHead
        title="KYC"
        desc={
          pending
            ? `${pending} waiting${oldest ? ` · oldest submitted ${timeAgo(oldest)}` : ""}. Approving unlocks withdrawals for that user.`
            : "Nothing waiting. Approving a submission unlocks withdrawals for that user."
        }
        actions={
          first ? (
            <Link className="admin-btn admin-btn--primary" href={`/admin/kyc/${first.id}`}>
              Start reviewing
              <Icon name="arrowRight" size={16} />
            </Link>
          ) : null
        }
      />

      <section className="admin-card">
        <TabBar
          label="KYC views"
          active={tab}
          tabs={[
            { key: "pending", label: "Waiting", href: tabHref("pending"), count: counts.pending },
            { key: "verified", label: "Verified", href: tabHref("verified"), count: counts.verified },
            { key: "rejected", label: "Rejected", href: tabHref("rejected"), count: counts.rejected },
          ]}
        />
        <div className="admin-toolbar">
          <TableControls placeholder="Search name, email or PAN" />
          <span className="admin-result-count">{tab === "pending" ? "Oldest first" : "Newest first"}</span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>{tab === "pending" ? "Submitted" : "Decided"}</th>
                <th>Documents</th>
                {tab === "rejected" ? <th>Reason given</th> : null}
                <th className="admin-num-right">
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow
                  cols={cols}
                  message={
                    q
                      ? "No submissions match that search."
                      : tab === "pending"
                        ? "Nothing waiting. Every submission has a decision."
                        : tab === "verified"
                          ? "No verified users yet."
                          : "No rejected submissions."
                  }
                />
              ) : (
                rows.map((u) => {
                  const name = userName(u);
                  const docs = u._count.kycDocuments;
                  const all = docs >= KYC_DOCUMENT_KINDS.length;
                  const hot = !!u.kycSubmittedAt && Date.now() - u.kycSubmittedAt.getTime() >= DAY;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="admin-cell-user">
                          <Avatar name={name} size={32} />
                          <div>
                            <div className="admin-cell-strong">
                              {name} {u.role === "AFFILIATE" ? <Tag>Affiliate</Tag> : null}
                            </div>
                            <div className="admin-cell-sub">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {tab === "pending" ? (
                          u.kycSubmittedAt ? (
                            <>
                              <div>{fmtDate(u.kycSubmittedAt)}</div>
                              <div className={`admin-cell-sub${hot ? " admin-age hot" : ""}`}>{timeAgo(u.kycSubmittedAt)}</div>
                            </>
                          ) : (
                            <span className="admin-cell-sub">Before photo KYC</span>
                          )
                        ) : (
                          <span className="admin-age">{fmtDate(u.updatedAt)}</span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontWeight: 600,
                            color: all ? "var(--admin-pos)" : "var(--admin-warn)",
                          }}
                        >
                          <Icon name={all ? "check" : "alert"} size={15} />
                          {all ? `All ${KYC_DOCUMENT_KINDS.length} photos` : `${docs} of ${KYC_DOCUMENT_KINDS.length} photos`}
                        </span>
                      </td>
                      {tab === "rejected" ? (
                        <td className="admin-cell-sub" style={{ maxWidth: 320, color: "var(--admin-muted)" }}>
                          {u.kycReviewNote ?? "—"}
                        </td>
                      ) : null}
                      <td className="admin-num-right">
                        <Link href={`/admin/kyc/${u.id}`} className="admin-btn admin-btn--sm admin-btn--ghost">
                          {tab === "pending" ? "Review" : "View"}
                        </Link>
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
