import Link from "next/link";
import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, EmptyRow, Pager, SortableTh, StatusPill, Tag } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDate, usdFromMinor } from "../../_lib/format";

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
    ...(role ? { role: role as "USER" | "ADMIN" } : {}),
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

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { [sort]: dir },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { accounts: { where: { type: "LIVE" }, select: { realBalance: true, bonusBalance: true } } },
    }),
  ]);

  const spForLinks: Record<string, string | undefined> = {
    q: q || undefined,
    role: sp.role,
    kyc: sp.kyc,
    sort,
    dir,
  };

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <TableControls
          searchKey="q"
          placeholder="Search name, email…"
          filters={[
            {
              param: "role",
              label: "Role",
              options: [
                { value: "all", label: "All roles" },
                { value: "USER", label: "User" },
                { value: "ADMIN", label: "Admin" },
              ],
            },
            {
              param: "kyc",
              label: "KYC",
              options: [
                { value: "all", label: "All KYC" },
                { value: "NOT_STARTED", label: "Not started" },
                { value: "PENDING", label: "Pending" },
                { value: "VERIFIED", label: "Verified" },
                { value: "REJECTED", label: "Rejected" },
              ],
            },
          ]}
        />
        <div className="admin-spacer" />
        <span className="admin-result-count">
          {total} account{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh label="Account" colKey="email" path={PATH} sp={spForLinks} />
              <SortableTh label="Role" colKey="role" path={PATH} sp={spForLinks} />
              <SortableTh label="KYC" colKey="kycStatus" path={PATH} sp={spForLinks} />
              <th className="admin-num-right">Live balance</th>
              <SortableTh
                label="Deposited"
                colKey="cumulativeDeposits"
                path={PATH}
                sp={spForLinks}
                align="right"
              />
              <SortableTh label="Joined" colKey="createdAt" path={PATH} sp={spForLinks} align="right" />
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <EmptyRow cols={7} message="No accounts match your filters." />
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
                          <div className="admin-cell-strong">{name}</div>
                          <div className="admin-cell-sub">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Tag accent={u.role === "ADMIN"}>{u.role}</Tag>
                    </td>
                    <td>
                      <StatusPill status={u.kycStatus} />
                    </td>
                    <td className="num admin-num-right">
                      {bal ? usdFromMinor(bal) : <span style={{ color: "var(--admin-muted)" }}>—</span>}
                    </td>
                    <td className="num admin-num-right">{usdFromMinor(u.cumulativeDeposits)}</td>
                    <td className="num admin-num-right">{fmtDate(u.createdAt)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <Link
                          className="admin-btn admin-btn--sm admin-btn--subtle"
                          href={`/admin/users/${u.id}`}
                        >
                          <Icon name="edit" size={14} />
                          Manage
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
    </div>
  );
}
