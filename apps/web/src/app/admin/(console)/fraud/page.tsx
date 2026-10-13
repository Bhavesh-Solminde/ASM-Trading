import Link from "next/link";
import { prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, EmptyRow, PageHead, Pill, TabBar, Tag } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDateTime, hrefWith, timeAgo } from "../../_lib/format";
import {
  confirmAndBanAction,
  confirmAndFreezeAction,
  dismissFlagAction,
  unfreezeUserAction,
} from "./actions";

export const dynamic = "force-dynamic";

const PATH = "/admin/fraud";
type Tab = "open" | "frozen" | "resolved";

/**
 * The evidence JSON the detector writes is untyped in Prisma (Json column), so
 * we re-declare its shape here for the page's consumer. Any missing field
 * degrades to an empty display — the page never crashes on a partial payload.
 */
type EvidenceView = {
  score?: number;
  verdict?: "LINKED" | "WEAKLY_LINKED";
  sharedIps?: string[];
  sharedUserAgents?: string[];
  sharedDeviceFps?: string[];
  sharedMethods?: string[];
  minSignupGapSec?: number | null;
};

function readEvidence(v: unknown): EvidenceView {
  return (v && typeof v === "object" ? (v as EvidenceView) : {}) ?? {};
}

function humanGap(sec: number | null | undefined): string | null {
  if (sec == null) return null;
  if (sec < 60) return `${sec}s apart`;
  if (sec < 3600) return `${Math.round(sec / 60)} min apart`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h apart`;
  return `${Math.round(sec / 86_400)}d apart`;
}

function truncate(v: string, n: number): string {
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
}

/** A browser fingerprint string, shortened to what an operator needs to recognise it. */
function browserLabel(ua: string): string {
  const os = /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `Same browser · ${os}` : `Same browser · ${truncate(ua, 24)}`;
}

function UserStatus({ status }: { status: string }) {
  const tone = status === "ACTIVE" ? "pos" : status === "BANNED" ? "neg" : "warn";
  return <Pill tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Pill>;
}

export default async function FraudQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "frozen" || sp.tab === "resolved" ? sp.tab : "open";

  const [openFlags, frozenCount, resolvedCount] = await Promise.all([
    prisma.fraudFlag.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
      },
    }),
    prisma.user.count({ where: { status: { in: ["FROZEN", "BANNED", "FLAGGED"] } } }),
    prisma.fraudFlag.count({ where: { status: { in: ["DISMISSED", "CONFIRMED"] } } }),
  ]);

  const stronglyLinked = openFlags.filter((f) => readEvidence(f.evidence).verdict === "LINKED").length;
  const tabHref = (key: Tab) => hrefWith(PATH, {}, { tab: key === "open" ? null : key });

  return (
    <>
      <PageHead
        title="Fraud"
        desc={
          openFlags.length
            ? `${openFlags.length} open flag${openFlags.length === 1 ? "" : "s"}${stronglyLinked ? ` · ${stronglyLinked} strongly linked` : ""}. Each one lists the accounts that look linked and exactly which signals matched.`
            : "No open flags. Each flag lists the accounts that look linked and exactly which signals matched."
        }
      />

      <section className="admin-card">
        <TabBar
          label="Fraud views"
          active={tab}
          tabs={[
            { key: "open", label: "Open", href: tabHref("open"), count: openFlags.length },
            { key: "frozen", label: "Frozen & banned", href: tabHref("frozen"), count: frozenCount },
            { key: "resolved", label: "Resolved", href: tabHref("resolved"), count: resolvedCount },
          ]}
        />
        {tab === "open" ? <OpenFlags flags={openFlags} /> : tab === "frozen" ? <FrozenUsers /> : <ResolvedFlags />}
      </section>

      {tab === "open" && openFlags.length ? (
        <p className="admin-cell-sub" style={{ margin: 0 }}>
          Dismiss marks a false positive. Freeze blocks trading, deposits and withdrawals but keeps the balance. Ban
          can&rsquo;t be undone here.
        </p>
      ) : null}
    </>
  );
}

type OpenFlag = Awaited<ReturnType<typeof prisma.fraudFlag.findMany>>[number] & {
  user: { id: string; email: string; firstName: string | null; lastName: string | null; status: string };
};

async function OpenFlags({ flags }: { flags: OpenFlag[] }) {
  if (flags.length === 0) {
    return (
      <div className="admin-empty">
        <Icon name="check" size={30} />
        <div>The fraud queue is clear.</div>
      </div>
    );
  }

  // Batch-load every linked user across every open flag in one query, then
  // slice per flag. Avoids N+1 when the queue is deep.
  const linkedIds = Array.from(new Set(flags.flatMap((f) => f.linkedUserIds)));
  const linkedUsers = linkedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: linkedIds } },
        select: { id: true, email: true, status: true, signupIp: true, lastIp: true, createdAt: true },
      })
    : [];
  const usersById = new Map(linkedUsers.map((u) => [u.id, u]));

  return (
    <div>
      {flags.map((f) => {
        const ev = readEvidence(f.evidence);
        const gap = humanGap(ev.minSignupGapSec);
        const strong = ev.verdict === "LINKED";
        const linked = f.linkedUserIds
          .map((uid) => usersById.get(uid))
          .filter((u): u is NonNullable<typeof u> => u != null);
        const name = [f.user.firstName, f.user.lastName].filter(Boolean).join(" ") || f.user.email;

        return (
          <article key={f.id} className="admin-flag">
            <div className="admin-flag__head">
              <div className="admin-cell-user">
                <Avatar name={name} />
                <div>
                  <Link className="admin-cell-strong" href={`/admin/users/${f.user.id}`} style={{ textDecoration: "none" }}>
                    {f.user.email}
                  </Link>
                  <div className="admin-cell-sub">
                    Flagged {timeAgo(f.createdAt)} · account {f.user.status.toLowerCase()}
                  </div>
                </div>
              </div>
              <Pill tone={strong ? "neg" : "warn"}>
                {strong ? "Strongly linked" : "Weakly linked"}
                {typeof ev.score === "number" ? ` · score ${ev.score}` : ""}
              </Pill>
            </div>

            <div className="admin-flag__signals">
              <span className="admin-label" style={{ marginRight: 4 }}>
                Matched
              </span>
              {(ev.sharedIps ?? []).map((ip) => (
                <Tag key={`ip-${ip}`}>
                  Same IP <span className="mono">{ip}</span>
                </Tag>
              ))}
              {(ev.sharedDeviceFps ?? []).map((fp) => (
                <Tag key={`fp-${fp}`}>
                  Same device <span className="mono">{truncate(fp, 14)}</span>
                </Tag>
              ))}
              {(ev.sharedMethods ?? []).map((m) => (
                <Tag key={`m-${m}`}>
                  Same payout <span className="mono">{truncate(m, 24)}</span>
                </Tag>
              ))}
              {(ev.sharedUserAgents ?? []).map((ua) => (
                <Tag key={`ua-${ua}`}>
                  <span title={ua}>{browserLabel(ua)}</span>
                </Tag>
              ))}
              {gap ? <Tag>Signed up {gap}</Tag> : null}
            </div>

            {linked.length > 0 ? (
              <div className="admin-flag__linked admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Linked account</th>
                      <th>Status</th>
                      <th>Signup IP</th>
                      <th>Last IP</th>
                      <th>Signed up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linked.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link className="admin-link" href={`/admin/users/${u.id}`} style={{ fontWeight: 500 }}>
                            {u.email}
                          </Link>
                        </td>
                        <td>
                          <UserStatus status={u.status} />
                        </td>
                        <td className="mono">{u.signupIp ?? "—"}</td>
                        <td className="mono">{u.lastIp ?? "—"}</td>
                        <td className="admin-age">{timeAgo(u.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="admin-flag__actions">
              <form action={dismissFlagAction} style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 320px" }}>
                <input type="hidden" name="flagId" value={f.id} />
                <input
                  name="note"
                  placeholder="Review note (optional)"
                  aria-label="Review note"
                  className="admin-input"
                  style={{ maxWidth: 360, height: 34, padding: "0 10px", fontSize: 13 }}
                  maxLength={500}
                />
                <button type="submit" className="admin-btn admin-btn--sm admin-btn--ghost" title="Mark as a false positive. Users stay active.">
                  Dismiss
                </button>
              </form>
              <div style={{ display: "flex", gap: 8 }}>
                <form action={confirmAndFreezeAction}>
                  <input type="hidden" name="flagId" value={f.id} />
                  <button
                    type="submit"
                    className="admin-btn admin-btn--sm admin-btn--warn"
                    title="Confirm the flag and freeze every linked user."
                  >
                    Freeze all ({linked.length})
                  </button>
                </form>
                <form action={confirmAndBanAction}>
                  <input type="hidden" name="flagId" value={f.id} />
                  <button
                    type="submit"
                    className="admin-btn admin-btn--sm admin-btn--ban"
                    title="Confirm the flag and ban every linked user. Can't be undone here."
                  >
                    Ban all
                  </button>
                </form>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Every user whose status isn't ACTIVE, with an unfreeze action. */
async function FrozenUsers() {
  const users = await prisma.user.findMany({
    where: { status: { in: ["FROZEN", "BANNED", "FLAGGED"] } },
    orderBy: { statusChangedAt: "desc" },
    take: 50,
    select: { id: true, email: true, status: true, statusReason: true, statusChangedAt: true },
  });

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Status</th>
            <th>Reason</th>
            <th>Since</th>
            <th className="admin-num-right">
              <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Unfreeze</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <EmptyRow cols={5} message="No users are frozen or banned." />
          ) : (
            users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link className="admin-link" href={`/admin/users/${u.id}`} style={{ fontWeight: 500 }}>
                    {u.email}
                  </Link>
                </td>
                <td>
                  <UserStatus status={u.status} />
                </td>
                <td style={{ maxWidth: 360, color: "var(--admin-muted)" }} title={u.statusReason ?? ""}>
                  {u.statusReason ? truncate(u.statusReason, 80) : "—"}
                </td>
                <td className="admin-age">{u.statusChangedAt ? timeAgo(u.statusChangedAt) : "—"}</td>
                <td className="admin-num-right">
                  <form action={unfreezeUserAction}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button type="submit" className="admin-btn admin-btn--sm admin-btn--ghost">
                      Unfreeze
                    </button>
                  </form>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The last 25 decided flags, newest first. */
async function ResolvedFlags() {
  const flags = await prisma.fraudFlag.findMany({
    where: { status: { in: ["DISMISSED", "CONFIRMED"] } },
    orderBy: { reviewedAt: "desc" },
    take: 25,
    include: { user: { select: { id: true, email: true } } },
  });

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Outcome</th>
            <th>Decided</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {flags.length === 0 ? (
            <EmptyRow cols={4} message="No flags have been decided yet." />
          ) : (
            flags.map((f) => (
              <tr key={f.id}>
                <td>
                  <Link className="admin-link" href={`/admin/users/${f.user.id}`} style={{ fontWeight: 500 }}>
                    {f.user.email}
                  </Link>
                </td>
                <td>
                  <Pill tone={f.status === "CONFIRMED" ? "neg" : "muted"}>
                    {f.status === "CONFIRMED" ? "Confirmed" : "Dismissed"}
                  </Pill>
                </td>
                <td className="admin-age">{f.reviewedAt ? fmtDateTime(f.reviewedAt) : "—"}</td>
                <td style={{ color: "var(--admin-muted)" }} title={f.reviewNote ?? ""}>
                  {f.reviewNote ? truncate(f.reviewNote, 80) : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
