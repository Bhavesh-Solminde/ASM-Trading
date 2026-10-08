import Link from "next/link";
import { notFound } from "next/navigation";
import { KYC_DOCUMENT_KINDS, listKycDocuments, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, Card, StatusPill } from "../../../_components/ui";
import { Icon } from "../../../_lib/icons";
import { fmtDate, fmtDateTime } from "../../../_lib/format";
import { approveKycAction, rejectKycAction } from "../actions";
import { KYC_REJECT_REASONS } from "../reasons";

export const dynamic = "force-dynamic";

const DOC_LABEL: Record<string, string> = {
  AADHAAR_FRONT: "Aadhaar — front",
  AADHAAR_BACK: "Aadhaar — back",
  PAN: "PAN card",
  SELFIE: "Selfie",
};

/** One submission: identity details, the four photos side by side, and the decision. */
export default async function KycReviewPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireAdmin();
  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      aadhaar: true,
      pan: true,
      address: true,
      country: true,
      kycStatus: true,
      kycSubmittedAt: true,
      kycReviewNote: true,
      createdAt: true,
    },
  });
  if (!user) notFound();

  const [docs, decision] = await Promise.all([
    listKycDocuments(user.id),
    prisma.auditLog.findFirst({
      where: { targetType: "User", targetId: user.id, action: { in: ["kyc.approved", "kyc.rejected"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email.split("@")[0]!;
  const pending = user.kycStatus === "PENDING";

  const row = (label: string, value: React.ReactNode) => (
    <div className="admin-set-row">
      <div className="lbl">{label}</div>
      <div className="num" style={{ color: "var(--admin-ink-2)", textAlign: "right" }}>
        {value}
      </div>
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Link href="/admin/kyc" className="admin-btn admin-btn--sm admin-btn--subtle" style={{ textDecoration: "none" }}>
          <Icon name="arrowUp" size={14} style={{ transform: "rotate(-90deg)" }} />
          Back to KYC queue
        </Link>
        <Link href={`/admin/users/${user.id}`} className="admin-btn admin-btn--sm admin-btn--ghost" style={{ textDecoration: "none" }}>
          Open user account
        </Link>
      </div>

      <div className="admin-grid admin-cols-3">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <Card title="Documents" sub="Click a photo to open it full size in a new tab.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {KYC_DOCUMENT_KINDS.map((kind) => {
                const doc = docs.find((d) => d.kind === kind);
                return (
                  <div key={kind}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{DOC_LABEL[kind]}</div>
                    {doc ? (
                      <a href={`/api/admin/kyc-documents/${doc.id}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- admin-gated image route */}
                        <img
                          src={`/api/admin/kyc-documents/${doc.id}`}
                          alt={DOC_LABEL[kind]}
                          style={{
                            width: "100%",
                            height: 200,
                            objectFit: "contain",
                            background: "var(--admin-bg-2, #0f1115)",
                            borderRadius: 8,
                            border: "1px solid var(--admin-border)",
                          }}
                        />
                      </a>
                    ) : (
                      <div
                        style={{
                          height: 200,
                          display: "grid",
                          placeItems: "center",
                          borderRadius: 8,
                          border: "1px dashed var(--admin-border)",
                          color: "var(--admin-muted)",
                          fontSize: 13,
                        }}
                      >
                        Not uploaded
                      </div>
                    )}
                    {doc ? (
                      <div style={{ color: "var(--admin-muted)", fontSize: 11, marginTop: 4 }}>
                        Uploaded {fmtDateTime(doc.updatedAt)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            title="Decision"
            sub={
              pending
                ? "Approving unlocks withdrawals. Rejecting sends the user back to fix and resubmit, with the reason below."
                : decision
                  ? `Decided ${fmtDateTime(decision.createdAt)}.`
                  : "This submission isn't waiting for review."
            }
          >
            {pending ? (
              <div style={{ display: "grid", gap: 16 }}>
                <form action={approveKycAction}>
                  <input type="hidden" name="userId" value={user.id} />
                  <button type="submit" className="admin-btn admin-btn--pos">
                    <Icon name="check" size={14} /> Approve — verify this user
                  </button>
                </form>

                <form action={rejectKycAction} style={{ display: "grid", gap: 8, borderTop: "1px solid var(--admin-border)", paddingTop: 16 }}>
                  <input type="hidden" name="userId" value={user.id} />
                  <div className="admin-field">
                    <label htmlFor="reason">Reject reason (shown to the user)</label>
                    <select id="reason" name="reason" className="admin-select" defaultValue={KYC_REJECT_REASONS[0]}>
                      {KYC_REJECT_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                      <option value="other">Other (write below)</option>
                    </select>
                  </div>
                  <div className="admin-field">
                    <label htmlFor="note">Extra detail (optional)</label>
                    <input id="note" name="note" className="admin-input" maxLength={300} placeholder="e.g. Upload the back of your Aadhaar again" />
                  </div>
                  <div>
                    <button type="submit" className="admin-btn admin-btn--danger">
                      <Icon name="x" size={14} /> Reject
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                <div>
                  Status: <StatusPill status={user.kycStatus} />
                </div>
                {user.kycStatus === "REJECTED" && user.kycReviewNote ? (
                  <div style={{ color: "var(--admin-muted)" }}>Reason given: {user.kycReviewNote}</div>
                ) : null}
                <div style={{ color: "var(--admin-muted)" }}>
                  To change it, use the KYC status on the{" "}
                  <Link href={`/admin/users/${user.id}`} style={{ color: "var(--admin-accent)" }}>
                    user account
                  </Link>
                  .
                </div>
              </div>
            )}
          </Card>
        </div>
        <Card title="Applicant">
          <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 14, borderBottom: "1px solid var(--admin-border)" }}>
            <Avatar name={name} size={48} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{name}</div>
              <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>{user.email}</div>
              <div style={{ marginTop: 6 }}>
                <StatusPill status={user.kycStatus} />
              </div>
            </div>
          </div>
          {row("First name", user.firstName || "—")}
          {row("Last name", user.lastName || "—")}
          {row("Date of birth", user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : "—")}
          {row("Aadhaar", user.aadhaar ? user.aadhaar.replace(/(\d{4})(?=\d)/g, "$1 ") : "—")}
          {row("PAN", user.pan || "—")}
          {row("Address", user.address || "—")}
          {row("Country", user.country || "—")}
          {row("Submitted", user.kycSubmittedAt ? fmtDateTime(user.kycSubmittedAt) : "—")}
          {row("Account created", fmtDate(user.createdAt))}
        </Card>
      </div>
    </>
  );
}
