import type { ProgramSummary } from "@asm/db";
import { ResendVerificationButton } from "@/app/(platform)/affiliate/dashboard/ResendVerificationButton";
import { Icon } from "@/components/shell/Icon";

const STATUS_NOTES = {
  PENDING_APPROVAL: {
    title: "Waiting for approval",
    message: "We’re reviewing your affiliate account. Referrals still count. Earnings stay on hold until your account is approved.",
  },
  SUSPENDED: {
    title: "Affiliate account suspended",
    message: "Your records stay visible. New earnings are held and transfers and withdrawals are paused. Contact support for details.",
  },
} as const;

export function AffiliateAccountNotices({
  email, emailVerified, status, verified, verify,
}: {
  email: string;
  emailVerified: boolean;
  status: ProgramSummary["affiliateStatus"];
  verified: string | undefined;
  verify: string | undefined;
}) {
  const note = status === "PENDING_APPROVAL" || status === "SUSPENDED" ? STATUS_NOTES[status] : null;
  return (
    <>
      {verified === "1" && emailVerified ? (
        <p role="status" className="rounded-xl border border-up/40 bg-up/10 px-4 py-3 text-sm text-up">
          Your email is verified.
        </p>
      ) : null}
      {verify === "invalid" && !emailVerified ? (
        <p role="alert" className="rounded-xl border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">
          That verification link is invalid or has expired. Send yourself a new one below.
        </p>
      ) : null}
      {!emailVerified ? (
        <section className="rounded-xl border border-rule bg-panel p-4" aria-label="Email verification">
          <h2 className="flex items-center gap-2 text-sm font-bold"><Icon name="shield" />Verify your email</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Open the verification link sent to <strong className="break-all text-ink">{email}</strong>. It works for 24 hours.
          </p>
          <ResendVerificationButton />
        </section>
      ) : null}
      {note ? (
        <section className="rounded-xl border border-caution/30 bg-caution/10 p-4" aria-label="Affiliate status">
          <h2 className="flex items-center gap-2 text-sm font-bold"><Icon name="alert" className="size-[18px] text-caution" />{note.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{note.message}</p>
        </section>
      ) : null}
    </>
  );
}
