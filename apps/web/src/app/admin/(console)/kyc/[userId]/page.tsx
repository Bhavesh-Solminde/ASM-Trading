import Link from "next/link";
import { notFound } from "next/navigation";
import { KYC_DOCUMENT_KINDS, listKycDocuments, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Avatar, Card, PageHead, StatusPill } from "../../../_components/ui";
import { Icon } from "../../../_lib/icons";
import { fmtDate, fmtDateTime, timeAgo } from "../../../_lib/format";
import { approveKycAction, rejectKycAction } from "../actions";
import { KYC_REJECT_REASONS } from "../reasons";

export const dynamic = "force-dynamic";

const DOC_LABEL: Record<string, string> = {
  AADHAAR_FRONT: "Aadhaar · front",
  AADHAAR_BACK: "Aadhaar · back",
  PAN: "PAN card",
  SELFIE: "Selfie",
};

/** One submission: the four photos beside the applicant's details, and one decision panel. */
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

  const pending = user.kycStatus === "PENDING";
  const [docs, decision, queue] = await Promise.all([
    listKycDocuments(user.id),
    prisma.auditLog.findFirst({
      where: { targetType: "User", targetId: user.id, action: { in: ["kyc.approved", "kyc.verified", "kyc.rejected"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    // Same order as the queue page, so previous / next walk it exactly.
    pending
      ? prisma.user.findMany({
          where: { kycStatus: "PENDING" },
          orderBy: [{ kycSubmittedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }],
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ]);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email.split("@")[0]!;
  const pos = queue.findIndex((u) => u.id === user.id);
  const prev = pos > 0 ? queue[pos - 1] : undefined;
  const next = pos >= 0 && pos < queue.length - 1 ? queue[pos + 1] : undefined;
  const overdue = !!user.kycSubmittedAt && Date.now() - user.kycSubmittedAt.getTime() >= 86400_000;

  return (
    <>
      <PageHead
        title={name}
        back={{ href: "/admin/kyc", label: "KYC queue" }}
        desc={
          <>
            {user.email}
            {user.kycSubmittedAt ? <> · submitted {fmtDateTime(user.kycSubmittedAt)}</> : null}
            {pending && user.kycSubmittedAt ? (
              <span style={{ color: overdue ? "var(--admin-warn)" : undefined }}>
                {" "}
                · waiting {timeAgo(user.kycSubmittedAt).replace(" ago", "")}
              </span>
            ) : null}
          </>
        }
        actions={
          pending && pos >= 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="admin-cell-sub" style={{ marginRight: 4 }}>
                {pos + 1} of {queue.length}
              </span>
              {prev ? (
                <Link className="admin-btn admin-btn--sm admin-btn--ghost" href={`/admin/kyc/${prev.id}`}>
                  <Icon name="chevronLeft" size={14} />
                  Previous
                </Link>
              ) : (
                <span className="admin-btn admin-btn--sm admin-btn--ghost" aria-disabled="true" style={{ opacity: 0.4 }}>
                  <Icon name="chevronLeft" size={14} />
                  Previous
                </span>
              )}
              {next ? (
                <Link className="admin-btn admin-btn--sm admin-btn--ghost" href={`/admin/kyc/${next.id}`}>
                  Next
                  <Icon name="chevronRight" size={14} />
                </Link>
              ) : (
                <span className="admin-btn admin-btn--sm admin-btn--ghost" aria-disabled="true" style={{ opacity: 0.4 }}>
                  Next
                  <Icon name="chevronRight" size={14} />
                </span>
              )}
            </div>
          ) : (
            <StatusPill status={user.kycStatus} />
          )
        }
      />

      <div className="admin-split">
        <Card title="Documents" sub="Click a photo to open it full size" bodyClass="admin-docs">
          {KYC_DOCUMENT_KINDS.map((kind) => {
            const doc = docs.find((d) => d.kind === kind);
            return (
              <figure key={kind} className="admin-doc">
                {doc ? (
                  <a className="admin-doc__img" href={`/api/admin/kyc-documents/${doc.id}`} target="_blank" rel="noreferrer">
                    <img src={`/api/admin/kyc-documents/${doc.id}`} alt={DOC_LABEL[kind]} />
                    <span className="admin-doc__open">Open</span>
                  </a>
                ) : (
                  <div className="admin-doc__img missing">Not uploaded</div>
                )}
                <figcaption>
                  <b>{DOC_LABEL[kind]}</b>
                  {doc ? <span className="admin-cell-sub">{fmtDateTime(doc.updatedAt)}</span> : null}
                </figcaption>
              </figure>
            );
          })}
        </Card>

        <div className="admin-split__side">
          <Card
            title="Applicant"
            action={
              <Link className="admin-link" href={`/admin/users/${user.id}`} style={{ fontSize: 13 }}>
                Open account
              </Link>
            }
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <Avatar name={name} size={40} />
              <StatusPill status={user.kycStatus} />
            </div>
            <dl className="admin-dl">
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
              <dt>Country</dt>
              <dd>{user.country === "IN" ? "India" : user.country || "—"}</dd>
              <dt>Account created</dt>
              <dd>{fmtDate(user.createdAt)}</dd>
            </dl>
          </Card>

          <Card
            title="Decision"
            sub={
              pending
                ? undefined
                : decision
                  ? `Decided ${fmtDateTime(decision.createdAt)}`
                  : "This submission isn't waiting for review"
            }
          >
            {pending ? (
              <div style={{ display: "grid", gap: 14 }}>
                <form action={approveKycAction}>
                  <input type="hidden" name="userId" value={user.id} />
                  <button type="submit" className="admin-btn admin-btn--pos admin-btn--block admin-btn--lg">
                    <Icon name="check" size={16} />
                    Approve and verify
                  </button>
                </form>
                <div className="admin-or">or reject</div>
                <form action={rejectKycAction} style={{ display: "grid", gap: 12 }}>
                  <input type="hidden" name="userId" value={user.id} />
                  <div className="admin-field" style={{ margin: 0 }}>
                    <label htmlFor="reason">Reason shown to the user</label>
                    <select id="reason" name="reason" className="admin-select" defaultValue={KYC_REJECT_REASONS[0]}>
                      {KYC_REJECT_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                      <option value="other">Other (write below)</option>
                    </select>
                  </div>
                  <div className="admin-field" style={{ margin: 0 }}>
                    <label htmlFor="note">Extra detail (optional)</label>
                    <input
                      id="note"
                      name="note"
                      className="admin-input"
                      maxLength={300}
                      placeholder="e.g. Upload the back of your Aadhaar again"
                    />
                  </div>
                  <button type="submit" className="admin-btn admin-btn--danger admin-btn--block admin-btn--lg">
                    Reject and ask to resubmit
                  </button>
                </form>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8, fontSize: 13.5 }}>
                {user.kycStatus === "REJECTED" && user.kycReviewNote ? (
                  <div style={{ color: "var(--admin-muted)" }}>Reason given: {user.kycReviewNote}</div>
                ) : null}
                <div style={{ color: "var(--admin-muted)" }}>
                  To change it, set the KYC status on the{" "}
                  <Link className="admin-link" href={`/admin/users/${user.id}`}>
                    user&rsquo;s account
                  </Link>
                  .
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
