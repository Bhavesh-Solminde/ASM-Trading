import Link from "next/link";
import { KYC_DOCUMENT_KINDS, prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, Card, EmptyRow, Pager, Pill, StatCard, Tag } from "../../_components/ui";
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

function TabBar({ tab, sp, counts }: { tab: Tab; sp: Record<string, string | undefined>; counts: Record<Tab, number> }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "verified", label: "Verified" },
    { key: "rejected", label: "Rejected" },
  ];
  return (
    <div className="admin-tabbar" role="tablist" aria-label="KYC sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          href={hrefWith(PATH, sp, { tab: t.key === "pending" ? null : t.key, page: null })}
          className={`admin-tab${tab === t.key ? " active" : ""}`}
        >
          {t.label}
          {/* Only the pending count is work to do; the others are history. */}
          {t.key === "pending" && counts.pending ? <span className="admin-tab__badge">{counts.pending}</span> : null}
        </Link>
      ))}
    </div>
  );
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

  return (
    <>
      <div className="admin-grid admin-stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <StatCard label="Waiting for review" value={String(pending)} icon="shield" warn={pending! > 0} />
        <StatCard label="Verified" value={String(verified)} icon="check" />
        <StatCard label="Rejected" value={String(rejected)} icon="x" />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title={tab === "pending" ? "KYC awaiting review" : tab === "verified" ? "Verified users" : "Rejected submissions"}
          sub={
            tab === "pending"
              ? "Oldest first. Open a submission to check the photos and approve or reject it."
              : tab === "verified"
                ? "These users can withdraw."
                : "The user sees the reason and can fix and resubmit."
          }
          noBody
        >
          <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
            <TabBar tab={tab} sp={sp} counts={counts} />
          </div>
          <div style={{ padding: 12, borderBottom: "1px solid var(--admin-border)" }}>
            <TableControls placeholder="Search name, email or PAN…" />
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>{tab === "pending" ? "Submitted" : "Decided"}</th>
                  <th>Documents</th>
                  {tab === "rejected" ? <th>Reason</th> : null}
                  <th className="admin-num-right">Actions</th>
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
                          ? "No KYC submissions waiting for review."
                          : tab === "verified"
                            ? "No verified users yet."
                            : "No rejected submissions."
                    }
                  />
                ) : (
                  rows.map((u) => {
                    const name = userName(u);
                    const docs = u._count.kycDocuments;
                    return (
                      <tr key={u.id}>
                        <td>
                          <div className="admin-cell-user">
                            <Avatar name={name} size={26} />
                            <div>
                              <div className="admin-cell-strong">
                                {name} {u.role === "AFFILIATE" ? <Tag>Affiliate</Tag> : null}
                              </div>
                              <div className="admin-cell-sub">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="admin-cell-sub">
                          {tab === "pending"
                            ? u.kycSubmittedAt
                              ? timeAgo(u.kycSubmittedAt)
                              : "before photo KYC"
                            : fmtDate(u.updatedAt)}
                        </td>
                        <td>
                          <Pill tone={docs >= KYC_DOCUMENT_KINDS.length ? "pos" : "warn"}>
                            {docs}/{KYC_DOCUMENT_KINDS.length} photos
                          </Pill>
                        </td>
                        {tab === "rejected" ? (
                          <td className="admin-cell-sub" style={{ maxWidth: 280 }}>
                            {u.kycReviewNote ?? "—"}
                          </td>
                        ) : null}
                        <td className="admin-num-right">
                          <Link
                            href={`/admin/kyc/${u.id}`}
                            className={`admin-btn admin-btn--sm ${tab === "pending" ? "admin-btn--primary" : "admin-btn--ghost"}`}
                            style={{ textDecoration: "none" }}
                          >
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

          <div style={{ padding: 12 }}>
            <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
          </div>
        </Card>
      </div>
    </>
  );
}
