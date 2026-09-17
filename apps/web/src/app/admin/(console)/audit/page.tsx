import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { Avatar, EmptyRow, Pager, SortableTh, Tag } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDateTime, timeAgo } from "../../_lib/format";

export const dynamic = "force-dynamic";

const PER_PAGE = 15;
const PATH = "/admin/audit";
const SORT_COLS = new Set(["createdAt", "action", "targetType", "actorId"]);

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const q = sp.q?.trim() ?? "";
  const targetType = sp.type && sp.type !== "all" ? sp.type : undefined;
  const sort = sp.sort && SORT_COLS.has(sp.sort) ? sp.sort : "createdAt";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(targetType ? { targetType } : {}),
    ...(q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" } },
            { actorId: { contains: q, mode: "insensitive" } },
            { targetId: { contains: q, mode: "insensitive" } },
            { targetType: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows, types] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { [sort]: dir },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.auditLog.findMany({ distinct: ["targetType"], select: { targetType: true } }),
  ]);

  const spForLinks: Record<string, string | undefined> = {
    q: q || undefined,
    type: sp.type,
    sort,
    dir,
  };

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <TableControls
          searchKey="q"
          placeholder="Search actor, action, target…"
          filters={[
            {
              param: "type",
              label: "Target",
              options: [
                { value: "all", label: "All targets" },
                ...types.map((t) => ({ value: t.targetType, label: t.targetType })),
              ],
            },
          ]}
        />
        <div className="admin-spacer" />
        <span className="admin-result-count">
          {total} event{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh label="Actor" colKey="actorId" path={PATH} sp={spForLinks} />
              <SortableTh label="Action" colKey="action" path={PATH} sp={spForLinks} />
              <SortableTh label="Target" colKey="targetType" path={PATH} sp={spForLinks} />
              <SortableTh label="When" colKey="createdAt" path={PATH} sp={spForLinks} align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow cols={4} message="No audit events match." />
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="admin-cell-user">
                      {r.actorId ? (
                        <Avatar name={r.actorId} size={28} />
                      ) : (
                        <span className="admin-stat__ic" style={{ width: 28, height: 28 }}>
                          <Icon name="grid" size={14} />
                        </span>
                      )}
                      <span className="admin-cell-strong">{r.actorId ?? "system"}</span>
                    </div>
                  </td>
                  <td>
                    <span style={{ color: "var(--admin-muted)" }}>
                      {r.action.replace(/[._]/g, " ")}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <Tag>{r.targetType}</Tag>
                      <span className="mono admin-cell-sub" style={{ fontSize: 11 }}>
                        {r.targetId.slice(0, 18)}
                      </span>
                    </div>
                  </td>
                  <td className="num admin-num-right" title={fmtDateTime(r.createdAt)}>
                    {timeAgo(r.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
    </div>
  );
}
