import Link from "next/link";
import { notFound } from "next/navigation";
import { KYC_DOCUMENT_KINDS, KycStatus, Role, listKycDocuments, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { ChangeAwareForm } from "../../../_components/ChangeAwareForm";
import { Avatar, Card, Pill, Tag } from "../../../_components/ui";
import { Icon } from "../../../_lib/icons";
import { fmtDate, inrFromMinor, num } from "../../../_lib/format";
import { CopyText } from "../../deposits/_components/CopyText";
import { updateUserAction } from "../actions";

export const dynamic = "force-dynamic";

const DOC_LABEL: Record<string, string> = {
  AADHAAR_FRONT: "Aadhaar front",
  AADHAAR_BACK: "Aadhaar back",
  PAN: "PAN",
  SELFIE: "Selfie",
};
const ROLE_LABEL: Record<string, string> = { USER: "User", AFFILIATE: "Affiliate", ADMIN: "Admin" };
const KYC_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  PENDING: "Pending",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
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

function truncateMiddle(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
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

  const kycDocs = await listKycDocuments(user.id);
  const name = displayName(user);
  const live = user.accounts.find((a) => a.type === "LIVE");
  const demo = user.accounts.find((a) => a.type === "DEMO");
  const kycPending = user.kycStatus === "PENDING";

  return (
    <>
      <div>
        <Link className="admin-back" href="/admin/users">
          <Icon name="chevronLeft" size={16} />
          Users
        </Link>
        <div className="admin-head">
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <Avatar name={name} size={52} />
            <div style={{ minWidth: 0 }}>
              <h1>{name}</h1>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6 }}>
                <span style={{ color: "var(--admin-muted)", fontSize: 13.5 }}>
                  {user.email} · joined {fmtDate(user.createdAt)}
                </span>
                {user.role !== "USER" ? <Tag accent>{ROLE_LABEL[user.role] ?? user.role}</Tag> : null}
                {user.status !== "ACTIVE" ? (
                  <Pill tone={user.status === "BANNED" ? "neg" : "warn"}>
                    {user.status.charAt(0) + user.status.slice(1).toLowerCase()}
                  </Pill>
                ) : null}
                <Pill tone={user.kycStatus === "VERIFIED" ? "pos" : user.kycStatus === "PENDING" ? "warn" : user.kycStatus === "REJECTED" ? "neg" : "muted"}>
                  KYC {KYC_LABEL[user.kycStatus]?.toLowerCase()}
                </Pill>
                <Pill tone={user.emailVerified ? "pos" : "muted"}>{user.emailVerified ? "Email verified" : "Email unverified"}</Pill>
                <Pill tone={user.liveAccess ? "info" : "muted"}>{user.liveAccess ? "Live access on" : "Demo only"}</Pill>
              </div>
            </div>
          </div>
          {kycPending ? (
            <Link className="admin-btn admin-btn--primary" href={`/admin/kyc/${user.id}`}>
              Review KYC
            </Link>
          ) : null}
        </div>
      </div>

      <section className="admin-card admin-strip" aria-label="Balances">
        <div className="admin-strip__cell">
          <span className="admin-label">Live balance</span>
          <span className="admin-strip__val">{live ? inrFromMinor(live.realBalance + live.bonusBalance) : "—"}</span>
          <span className="admin-cell-sub">Real + bonus</span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Demo balance</span>
          <span className="admin-strip__val">{demo ? inrFromMinor(demo.realBalance) : "—"}</span>
          <span className="admin-cell-sub">Practice</span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Deposited</span>
          <span className="admin-strip__val">{inrFromMinor(user.cumulativeDeposits)}</span>
          <span className="admin-cell-sub">
            {user._count.deposits} deposit{user._count.deposits === 1 ? "" : "s"}, lifetime
          </span>
        </div>
        <div className="admin-strip__cell">
          <span className="admin-label">Trades</span>
          <span className="admin-strip__val">{num(live?.tradesCount ?? 0)}</span>
          <span className="admin-cell-sub">
            {user._count.withdrawals} withdrawal{user._count.withdrawals === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      <div className="admin-grid admin-cols-2" style={{ alignItems: "start" }}>
        <Card title="Account controls" action={<span className="admin-cell-sub">Every change is audit-logged</span>}>
          <ChangeAwareForm action={updateUserAction}>
            <input type="hidden" name="userId" value={user.id} />
            <div className="admin-set-row">
              <div>
                <label className="lbl" htmlFor="role">
                  Role
                </label>
                <div className="desc">What this account can do</div>
              </div>
              <select id="role" name="role" className="admin-filter-select" defaultValue={user.role}>
                {Object.values(Role).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-set-row">
              <div>
                <label className="lbl" htmlFor="kycStatus">
                  KYC status
                </label>
                <div className="desc">Set by the review; override only if needed</div>
              </div>
              <select id="kycStatus" name="kycStatus" className="admin-filter-select" defaultValue={user.kycStatus}>
                {Object.values(KycStatus).map((k) => (
                  <option key={k} value={k}>
                    {KYC_LABEL[k] ?? k}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-set-row">
              <div>
                <label className="lbl" htmlFor="liveAccess">
                  Live account
                </label>
                <div className="desc">Real-money trading is allowed</div>
              </div>
              {/* The checkbox comes first so a checked box wins; the hidden
                  input is the value sent when it's unchecked. */}
              <label className="admin-switch">
                <input id="liveAccess" type="checkbox" name="liveAccess" value="true" defaultChecked={user.liveAccess} />
                <span className="track" />
              </label>
              <input type="hidden" name="liveAccess" value="false" />
            </div>
            <div className="admin-set-row">
              <div>
                <label className="lbl" htmlFor="vpnBlock">
                  Block VPN and proxies
                </label>
                <div className="desc">Sign-ins through a VPN are refused</div>
              </div>
              <label className="admin-switch">
                <input id="vpnBlock" type="checkbox" name="vpnExempt" value="false" defaultChecked={!user.vpnExempt} />
                <span className="track" />
              </label>
              <input type="hidden" name="vpnExempt" value="true" />
            </div>
          </ChangeAwareForm>
        </Card>

        <Card title="Profile">
          <dl className="admin-dl">
            <dt>User ID</dt>
            <dd>
              <CopyText value={user.id} display={truncateMiddle(user.id)} label="user ID" />
            </dd>
            <dt>Country</dt>
            <dd>{user.country === "IN" ? "India" : user.country || "—"}</dd>
            <dt>Two-step sign-in</dt>
            <dd style={{ color: user.twoFaForLogin ? undefined : "var(--admin-muted)" }}>{user.twoFaForLogin ? "On" : "Off"}</dd>
            <dt>Deposits</dt>
            <dd>
              <Link className="admin-link" href={`/admin/deposits?tab=history&q=${encodeURIComponent(user.email)}`}>
                {user._count.deposits}
              </Link>
            </dd>
            <dt>Withdrawals</dt>
            <dd>
              <Link className="admin-link" href={`/admin/withdrawals?tab=history&q=${encodeURIComponent(user.email)}`}>
                {user._count.withdrawals}
              </Link>
            </dd>
            <dt>Support tickets</dt>
            <dd>{user._count.supportTickets}</dd>
          </dl>
        </Card>
      </div>

      <Card
        title="KYC submission"
        sub={
          user.kycSubmittedAt
            ? `Submitted ${fmtDate(user.kycSubmittedAt)}${kycPending ? " · waiting for review" : ""}`
            : "Not submitted yet"
        }
        action={
          user.kycSubmittedAt ? (
            <Link href={`/admin/kyc/${user.id}`} className="admin-btn admin-btn--sm admin-btn--ghost">
              {kycPending ? "Open review" : "View submission"}
            </Link>
          ) : null
        }
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
          <dl className="admin-dl" style={{ flex: "1 1 300px" }}>
            <dt>Name</dt>
            <dd>{[user.firstName, user.lastName].filter(Boolean).join(" ") || "—"}</dd>
            <dt>Date of birth</dt>
            <dd>
              {user.dateOfBirth
                ? user.dateOfBirth.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </dd>
            <dt>Aadhaar</dt>
            <dd className="mono">{user.aadhaar ? user.aadhaar.replace(/(\d{4})(?=\d)/g, "$1 ") : "—"}</dd>
            <dt>PAN</dt>
            <dd className="mono">{user.pan || "—"}</dd>
            <dt>Address</dt>
            <dd>{user.address || "—"}</dd>
          </dl>
          <div className="admin-thumbs" style={{ flex: "1 1 420px" }}>
            {KYC_DOCUMENT_KINDS.map((kind) => {
              const doc = kycDocs.find((d) => d.kind === kind);
              return doc ? (
                <a key={kind} href={`/api/admin/kyc-documents/${doc.id}`} target="_blank" rel="noreferrer">
                  <img src={`/api/admin/kyc-documents/${doc.id}`} alt={DOC_LABEL[kind] ?? kind} />
                  <span>{DOC_LABEL[kind] ?? kind}</span>
                </a>
              ) : (
                <div key={kind} className="missing">
                  <div>Not uploaded</div>
                  <span>{DOC_LABEL[kind] ?? kind}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </>
  );
}
