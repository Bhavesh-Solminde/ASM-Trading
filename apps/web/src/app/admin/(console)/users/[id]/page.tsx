import Link from "next/link";
import { notFound } from "next/navigation";
import { KycStatus, Role, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, Card, StatusPill, Tag } from "../../../_components/ui";
import { Icon } from "../../../_lib/icons";
import { fmtDate, usdFromMinor } from "../../../_lib/format";
import { updateUserAction } from "../actions";

export const dynamic = "force-dynamic";

function displayName(u: {
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  email: string;
}): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.nickname || u.email.split("@")[0]!;
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      accounts: true,
      _count: { select: { deposits: true, withdrawals: true, supportTickets: true } },
    },
  });
  if (!user) notFound();

  const name = displayName(user);
  const live = user.accounts.find((a) => a.type === "LIVE");
  const demo = user.accounts.find((a) => a.type === "DEMO");

  const detail = (label: string, value: React.ReactNode) => (
    <div className="admin-set-row">
      <div className="lbl">{label}</div>
      <div className="num" style={{ color: "var(--admin-ink-2)" }}>
        {value}
      </div>
    </div>
  );

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/admin/users"
          className="admin-btn admin-btn--sm admin-btn--subtle"
          style={{ textDecoration: "none" }}
        >
          <Icon name="arrowUp" size={14} style={{ transform: "rotate(-90deg)" }} />
          Back to users
        </Link>
      </div>

      <div className="admin-grid admin-cols-3">
        <Card title="Account profile">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              paddingBottom: 16,
              borderBottom: "1px solid var(--admin-border)",
            }}
          >
            <Avatar name={name} size={56} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{name}</div>
              <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>{user.email}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Tag accent={user.role === "ADMIN"}>{user.role}</Tag>
                <StatusPill status={user.kycStatus} />
                {user.emailVerified ? (
                  <span className="admin-pill admin-pill--pos">Email verified</span>
                ) : (
                  <span className="admin-pill admin-pill--muted">Email unverified</span>
                )}
              </div>
            </div>
          </div>

          {detail("User ID", <span style={{ fontSize: 12 }}>{user.id}</span>)}
          {detail("Country", user.country || "—")}
          {detail("Two-factor (login)", user.twoFaForLogin ? "Enabled" : "Off")}
          {detail("Deposits", `${user._count.deposits} total`)}
          {detail("Withdrawals", `${user._count.withdrawals} total`)}
          {detail("Support tickets", `${user._count.supportTickets} total`)}
          {detail("Joined", fmtDate(user.createdAt))}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Balances">
            <div className="admin-set-row">
              <div>
                <div className="lbl">Live account</div>
                <div className="desc">Real + bonus balance</div>
              </div>
              <div className="num" style={{ fontWeight: 600, fontSize: 15 }}>
                {live ? usdFromMinor(live.realBalance + live.bonusBalance) : "—"}
              </div>
            </div>
            <div className="admin-set-row">
              <div>
                <div className="lbl">Demo account</div>
                <div className="desc">Practice balance</div>
              </div>
              <div className="num" style={{ fontWeight: 600, fontSize: 15 }}>
                {demo ? usdFromMinor(demo.realBalance) : "—"}
              </div>
            </div>
            <div className="admin-set-row">
              <div className="lbl">Trades placed</div>
              <div className="num">{live?.tradesCount ?? 0}</div>
            </div>
            <div className="admin-set-row">
              <div className="lbl">Lifetime deposited</div>
              <div className="num">{usdFromMinor(user.cumulativeDeposits)}</div>
            </div>
          </Card>

          <Card title="Manage account" sub="Changes are recorded in the audit log.">
            <form action={updateUserAction} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <input type="hidden" name="userId" value={user.id} />
              <div className="admin-field">
                <label htmlFor="role">Role</label>
                <select id="role" name="role" className="admin-select" defaultValue={user.role}>
                  {Object.values(Role).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-field">
                <label htmlFor="kycStatus">KYC status</label>
                <select
                  id="kycStatus"
                  name="kycStatus"
                  className="admin-select"
                  defaultValue={user.kycStatus}
                >
                  {Object.values(KycStatus).map((k) => (
                    <option key={k} value={k}>
                      {k.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <Link href="/admin/users" className="admin-btn admin-btn--ghost">
                  Cancel
                </Link>
                <button type="submit" className="admin-btn admin-btn--primary">
                  Save changes
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
