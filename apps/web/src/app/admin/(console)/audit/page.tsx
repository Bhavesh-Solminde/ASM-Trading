import Link from "next/link";
import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { PageHead, Pager } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { auditSentence, auditTone } from "../../_lib/audit";
import { fmtDateTime, hrefWith, timeAgo } from "../../_lib/format";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;
const PATH = "/admin/audit";

/** "FraudFlag" → "Fraud flag". */
function typeLabel(t: string): string {
  return t.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^(.)(.*)$/, (_, a: string, b: string) => a + b.toLowerCase());
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yest = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function shortId(id: string): string {
  return id.length > 14 ? id.slice(0, 13) : id;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const q = sp.q?.trim() ?? "";
  const targetType = sp.type && sp.type !== "all" ? sp.type : undefined;
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
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.auditLog.groupBy({ by: ["targetType"], _count: { _all: true } }),
  ]);
  const allCount = types.reduce((n, t) => n + t._count._all, 0);

  const spForLinks: Record<string, string | undefined> = { q: q || undefined, type: sp.type };
  const chip = (value: string | undefined, label: string, count: number) => (
    <Link
      key={label}
      href={hrefWith(PATH, spForLinks, { type: value ?? null, page: null })}
      className={`admin-chip${targetType === value ? " active" : ""}`}
    >
      {label}
      <span className="n">{count}</span>
    </Link>
  );

  // Group the page's entries under day headings.
  const groups: { day: string; items: typeof rows }[] = [];
  for (const r of rows) {
    const day = dayLabel(r.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }

  return (
    <>
      <PageHead title="Audit log" desc="Every change made from this console, newest first. Entries can't be edited or deleted." />

      <section className="admin-card">
        <div className="admin-toolbar">
          <TableControls searchKey="q" placeholder="Search action or ID" />
          {chip(undefined, "All", allCount)}
          {types
            .sort((a, b) => b._count._all - a._count._all)
            .map((t) => chip(t.targetType, typeLabel(t.targetType), t._count._all))}
        </div>

        {rows.length === 0 ? (
          <div className="admin-empty">
            <Icon name="scroll" size={30} />
            <div>{q || targetType ? "No entries match." : "No audited actions yet."}</div>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.day}>
              <div className="admin-day">{g.day}</div>
              {g.items.map((a) => (
                <div key={a.id} className="admin-event">
                  <span className="admin-event__time" title={fmtDateTime(a.createdAt)}>
                    {timeAgo(a.createdAt)}
                  </span>
                  <span className={`admin-feed__dot ${auditTone(a.action)}`} />
                  <span className="admin-event__what">
                    {auditSentence(a.action, a.after)}
                    {a.actorId && a.actorId !== "admin-panel" ? <span className="admin-cell-sub"> · {a.actorId}</span> : null}
                  </span>
                  <span className="admin-event__target">
                    <span className="admin-tag">{typeLabel(a.targetType)}</span>
                    <span className="mono" title={a.targetId}>
                      {shortId(a.targetId)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ))
        )}

        <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
      </section>
    </>
  );
}
