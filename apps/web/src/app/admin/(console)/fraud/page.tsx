import { prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, Card, StatCard, Tag } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDateTime, timeAgo } from "../../_lib/format";
import {
  confirmAndBanAction,
  confirmAndFreezeAction,
  dismissFlagAction,
  unfreezeUserAction,
} from "./actions";

export const dynamic = "force-dynamic";

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
  if (sec < 3600) return `${Math.round(sec / 60)}m apart`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h apart`;
  return `${Math.round(sec / 86_400)}d apart`;
}

function truncate(v: string, n: number): string {
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
}

export default async function FraudQueuePage() {
  await requireAdmin();

  const [openFlags, resolvedFlags] = await Promise.all([
    prisma.fraudFlag.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
            signupIp: true,
            signupUserAgent: true,
            lastIp: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.fraudFlag.findMany({
      where: { status: { in: ["DISMISSED", "CONFIRMED"] } },
      orderBy: { reviewedAt: "desc" },
      take: 25,
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  // Batch-load every linked user across every open flag in one query, then
  // slice per flag. Avoids N+1 when the queue is deep.
  const linkedIds = Array.from(
    new Set(openFlags.flatMap((f) => f.linkedUserIds)),
  );
  const linkedUsers = linkedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: linkedIds } },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          signupIp: true,
          lastIp: true,
          createdAt: true,
        },
      })
    : [];
  const usersById = new Map(linkedUsers.map((u) => [u.id, u]));

  const stronglyLinked = openFlags.filter(
    (f) => readEvidence(f.evidence).verdict === "LINKED",
  ).length;
  const weaklyLinked = openFlags.length - stronglyLinked;

  return (
    <>
      <div
        className="admin-grid admin-stat-grid"
        style={{ gridTemplateColumns: "repeat(3,1fr)" }}
      >
        <StatCard
          label="Open flags"
          value={String(openFlags.length)}
          icon="shield"
          warn={openFlags.length > 0}
          foot={<span>awaiting operator review</span>}
        />
        <StatCard
          label="Strongly linked"
          value={String(stronglyLinked)}
          icon="ban"
          warn={stronglyLinked > 0}
          foot={<span>score ≥ 5 (multiple signals)</span>}
        />
        <StatCard
          label="Weakly linked"
          value={String(weaklyLinked)}
          icon="activity"
          foot={<span>score ≥ 3 (single signal)</span>}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title="Open flags"
          sub="Each card is one detector finding. Linked accounts are shown with the exact signals that matched. Dismiss = false positive; Freeze = block trades/deposits/withdrawals but keep the balance; Ban = irreversible."
        >
          {openFlags.length === 0 ? (
            <div className="admin-empty">
              <Icon name="check" size={34} />
              <div>Fraud queue is clear — no open flags.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {openFlags.map((f) => {
                const ev = readEvidence(f.evidence);
                const gap = humanGap(ev.minSignupGapSec);
                const linked = f.linkedUserIds
                  .map((uid) => usersById.get(uid))
                  .filter((u): u is NonNullable<typeof u> => u != null);

                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      padding: 16,
                      border: "1px solid var(--admin-border)",
                      borderRadius: "var(--admin-radius-sm)",
                      background: "var(--admin-surface-2)",
                    }}
                  >
                    {/* Header row: primary user + verdict + score */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        flexWrap: "wrap",
                      }}
                    >
                      <div className="admin-cell-user">
                        <Avatar
                          name={
                            [f.user.firstName, f.user.lastName]
                              .filter(Boolean)
                              .join(" ") || f.user.email
                          }
                        />
                        <div>
                          <div className="admin-cell-strong">{f.user.email}</div>
                          <div className="admin-cell-sub">
                            flagged {timeAgo(f.createdAt)} · status{" "}
                            <span className="mono">{f.user.status}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {ev.verdict ? (
                          <Tag accent={ev.verdict === "LINKED"}>
                            {ev.verdict === "LINKED" ? "LINKED" : "WEAKLY LINKED"}
                          </Tag>
                        ) : null}
                        {typeof ev.score === "number" ? (
                          <Tag>score {ev.score}</Tag>
                        ) : null}
                        <Tag>{f.kind.replace(/_/g, " ").toLowerCase()}</Tag>
                      </div>
                    </div>

                    {/* Evidence pills */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(ev.sharedIps ?? []).map((ip) => (
                        <Tag key={`ip-${ip}`}>IP {ip}</Tag>
                      ))}
                      {(ev.sharedDeviceFps ?? []).map((fp) => (
                        <Tag key={`fp-${fp}`}>fp {truncate(fp, 12)}</Tag>
                      ))}
                      {(ev.sharedMethods ?? []).map((m) => (
                        <Tag key={`m-${m}`} accent>
                          method {truncate(m, 24)}
                        </Tag>
                      ))}
                      {(ev.sharedUserAgents ?? []).map((ua) => (
                        <Tag key={`ua-${ua}`}>UA {truncate(ua, 32)}</Tag>
                      ))}
                      {gap ? <Tag>signed up {gap}</Tag> : null}
                    </div>

                    {/* Linked users table */}
                    {linked.length > 0 ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Status</th>
                              <th>Signup IP</th>
                              <th>Last IP</th>
                              <th>Signed up</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linked.map((u) => (
                              <tr key={u.id}>
                                <td className="admin-cell-sub">{u.email}</td>
                                <td>
                                  <span className="mono">{u.status}</span>
                                </td>
                                <td className="mono admin-cell-sub">
                                  {u.signupIp ?? "—"}
                                </td>
                                <td className="mono admin-cell-sub">
                                  {u.lastIp ?? "—"}
                                </td>
                                <td className="admin-cell-sub">
                                  {timeAgo(u.createdAt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {/* Action row */}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <form
                        action={dismissFlagAction}
                        style={{ display: "flex", gap: 8, alignItems: "center" }}
                      >
                        <input type="hidden" name="flagId" value={f.id} />
                        <input
                          name="note"
                          placeholder="Optional review note"
                          className="admin-input"
                          style={{ minWidth: 220 }}
                          maxLength={500}
                        />
                        <button
                          type="submit"
                          className="admin-btn admin-btn--sm"
                          title="Mark as false positive. Users stay ACTIVE."
                        >
                          Dismiss
                        </button>
                      </form>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <form action={confirmAndFreezeAction}>
                          <input type="hidden" name="flagId" value={f.id} />
                          <button
                            type="submit"
                            className="admin-btn admin-btn--sm admin-btn--danger"
                            title="Confirm the flag and freeze every linked user."
                          >
                            Confirm &amp; freeze all ({linked.length})
                          </button>
                        </form>
                        <form action={confirmAndBanAction}>
                          <input type="hidden" name="flagId" value={f.id} />
                          <button
                            type="submit"
                            className="admin-btn admin-btn--sm admin-btn--danger"
                            title="Confirm the flag and ban every linked user. Irreversible from this UI."
                          >
                            Confirm &amp; ban all
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="admin-grid admin-cols-2" style={{ marginTop: 16 }}>
        <Card
          title="Frozen / banned users"
          sub="Users with a non-ACTIVE status. Unfreeze returns them to ACTIVE."
          noBody
        >
          <FrozenUsersTable />
        </Card>

        <Card title="Recently resolved flags" sub="Last 25, newest first." noBody>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Outcome</th>
                  <th>When</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {resolvedFlags.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="admin-empty">
                        <Icon name="scroll" size={34} />
                        <div>No flags have been resolved yet.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  resolvedFlags.map((f) => (
                    <tr key={f.id}>
                      <td className="admin-cell-sub">{f.user.email}</td>
                      <td>
                        <span className="mono">{f.status}</span>
                      </td>
                      <td className="admin-cell-sub">
                        {f.reviewedAt ? fmtDateTime(f.reviewedAt) : "—"}
                      </td>
                      <td className="admin-cell-sub" title={f.reviewNote ?? ""}>
                        {f.reviewNote ? truncate(f.reviewNote, 60) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * A tiny inline server component: enumerates every user whose status is not
 * ACTIVE and offers an unfreeze form. Kept inline (not extracted) because it
 * is only used by this page and pulls the same admin styling context.
 */
async function FrozenUsersTable() {
  const users = await prisma.user.findMany({
    where: { status: { in: ["FROZEN", "BANNED", "FLAGGED"] } },
    orderBy: { statusChangedAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      status: true,
      statusReason: true,
      statusChangedAt: true,
    },
  });

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Status</th>
            <th>Reason</th>
            <th style={{ width: 1 }}></th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <div className="admin-empty">
                  <Icon name="check" size={34} />
                  <div>No users are currently frozen or banned.</div>
                </div>
              </td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.id}>
                <td className="admin-cell-sub">{u.email}</td>
                <td>
                  <span className="mono">{u.status}</span>
                </td>
                <td
                  className="admin-cell-sub"
                  title={u.statusReason ?? ""}
                  style={{ maxWidth: 260 }}
                >
                  {u.statusReason ? truncate(u.statusReason, 60) : "—"}
                </td>
                <td>
                  <form action={unfreezeUserAction}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button type="submit" className="admin-btn admin-btn--sm">
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
