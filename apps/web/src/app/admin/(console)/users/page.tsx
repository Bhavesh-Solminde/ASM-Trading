import Link from "next/link";
import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, EmptyRow, PageHead, Pager, Pill, SortableTh, StatusPill, Tag } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDate, hrefWith, inrFromMinor } from "../../_lib/format";

export const dynamic = "force-dynamic";

const PER_PAGE = 10;
const PATH = "/admin/users";
const SORT_COLS: Record<string, Prisma.UserOrderByWithRelationInput> = {
  email: {},
  role: {},
  kycStatus: {},
  createdAt: {},
  cumulativeDeposits: {},
};

function displayName(u: {
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  email: string;
}): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.nickname || u.email.split("@")[0]!;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const q = sp.q?.trim() ?? "";
  const role = sp.role && sp.role !== "all" ? sp.role : undefined;
  const kyc = sp.kyc && sp.kyc !== "all" ? sp.kyc : undefined;
  const sort = sp.sort && sp.sort in SORT_COLS ? sp.sort : "createdAt";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.UserWhereInput = {
    ...(role ? { role: role as "USER" | "ADMIN" | "AFFILIATE" } : {}),
    ...(kyc ? { kycStatus: kyc as never } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { nickname: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, users, kycGroups] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { [sort]: dir },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { accounts: { where: { type: "LIVE" }, select: { realBalance: true, bonusBalance: true } } },
    }),
    prisma.user.groupBy({ by: ["kycStatus"], _count: { _all: true } }),
  ]);
  const kycCount = (k: string) => kycGroups.find((g) => g.kycStatus === k)?._count._all ?? 0;
  const allCount = kycGroups.reduce((n, g) => n + g._count._all, 0);

  const spForLinks: Record<string, string | undefined> = {
    q: q || undefined,
    role: sp.role,
    kyc: sp.kyc,
    sort,
    dir,
  };

  const chip = (value: string | undefined, label: string, count?: number) => (
    <Link
      key={label}
      href={hrefWith(PATH, spForLinks, { kyc: value ?? null, page: null })}
      className={`admin-chip${kyc === value ? " active" : ""}`}
    >
      {label}
      {count != null ? <span className="n">{count}</span> : null}
    </Link>
  );

  return (
    <>
      <PageHead title="Users" desc={`${allCount} accounts. Open a row to see balances, KYC and account controls.`} />

      <section className="admin-card">
        <div className="admin-toolbar">
          <TableControls
            searchKey="q"
            placeholder="Search name or email"
            filters={[
              {
                param: "role",
                label: "Role",
                options: [
                  { value: "all", label: "All roles" },
                  { value: "USER", label: "Users" },
                  { value: "AFFILIATE", label: "Affiliates" },
                  { value: "ADMIN", label: "Admins" },
                ],
              },
            ]}
          />
          {chip(undefined, "All")}
          {chip("PENDING", "KYC pending", kycCount("PENDING"))}
          {chip("VERIFIED", "Verified", kycCount("VERIFIED"))}
          {chip("REJECTED", "Rejected", kycCount("REJECTED"))}
          {chip("NOT_STARTED", "Not started")}
          <span className="admin-result-count">
            {total} match{total === 1 ? "" : "es"}
          </span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <SortableTh label="Account" colKey="email" path={PATH} sp={spForLinks} />
                <SortableTh label="KYC" colKey="kycStatus" path={PATH} sp={spForLinks} />
                <th className="admin-num-right">Live balance</th>
                <SortableTh label="Deposited" colKey="cumulativeDeposits" path={PATH} sp={spForLinks} align="right" />
                <SortableTh label="Joined" colKey="createdAt" path={PATH} sp={spForLinks} />
                <th>
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <EmptyRow cols={6} message="No accounts match these filters." />
              ) : (
                users.map((u) => {
                  const name = displayName(u);
                  const bal = (u.accounts[0]?.realBalance ?? 0) + (u.accounts[0]?.bonusBalance ?? 0);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="admin-cell-user">
                          <Avatar name={name} />
                          <div>
                            <div className="admin-cell-strong" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <Link className="admin-rowlink" href={`/admin/users/${u.id}`}>
                                {name}
                              </Link>
                              {u.role !== "USER" ? <Tag accent={u.role === "ADMIN"}>{u.role === "AFFILIATE" ? "Affiliate" : "Admin"}</Tag> : null}
                              {u.status !== "ACTIVE" ? (
                                <Pill tone={u.status === "BANNED" ? "neg" : "warn"}>
                                  {u.status.charAt(0) + u.status.slice(1).toLowerCase()}
                                </Pill>
                              ) : null}
                            </div>
                            <div className="admin-cell-sub">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <StatusPill status={u.kycStatus} />
                      </td>
                      <td className="admin-num-right admin-amount">
                        {bal ? inrFromMinor(bal) : <span className="admin-cell-sub">—</span>}
                      </td>
                      <td className="admin-num-right" style={{ color: "var(--admin-muted)" }}>
                        {inrFromMinor(u.cumulativeDeposits)}
                      </td>
                      <td className="admin-age">{fmtDate(u.createdAt)}</td>
                      <td className="admin-num-right" style={{ width: 40 }}>
                        <Icon name="chevronRight" size={18} className="admin-row-chev" />
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
