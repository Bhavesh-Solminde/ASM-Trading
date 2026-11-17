import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ensureReferralCode, findUserById, formatMoney, getProgramSummary, listProgramActivity } from "@asm/db";
import { ProgramEarningsPanel } from "@/components/program/ProgramEarningsPanel";
import { InviteLink } from "@/components/shell/InviteLink";
import { PageFrame } from "@/components/shell/PageFrame";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { absoluteUrl } from "@/lib/site";
import { ResendVerificationButton } from "./ResendVerificationButton";

export const metadata: Metadata = { title: "Affiliate dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const KYC_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  PENDING: "In review",
  VERIFIED: "Verified",
  REJECTED: "Not approved",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING_VERIFICATION: "Waiting for email verification",
  PENDING_APPROVAL: "Waiting for approval",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
};
const STATUS_NOTE: Record<string, string> = {
  PENDING_APPROVAL:
    "We are reviewing your affiliate account. Referrals still count; earnings stay on hold and transfers and withdrawals unlock once it is approved.",
  SUSPENDED:
    "Your affiliate account is suspended. Your records stay visible; new earnings are held and transfers and withdrawals are paused. Contact support for details.",
};

const pct = (bps: number) => `${bps / 100}%`;
const whole = (minor: number) => formatMoney(minor, "INR").replace(/\.00$/, "");

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right font-semibold">{value}</dd>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-rule bg-panel p-4">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      <span className="text-xl font-bold tracking-tight text-ink">{value}</span>
      <span className="text-[10px] text-ink-3">{note}</span>
    </div>
  );
}

export default async function AffiliateDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; verify?: string }>;
}) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/affiliate/login");
  if (session.role !== "AFFILIATE") redirect("/referral");

  const [user, { verified, verify }] = await Promise.all([findUserById(session.userId), searchParams]);
  if (!user) redirect("/affiliate/login");
  const [code, summary, activity] = await Promise.all([
    ensureReferralCode(user.id),
    getProgramSummary(user.id),
    listProgramActivity(user.id, { limit: 50 }),
  ]);
  const t = summary.terms;
  const statusNote = STATUS_NOTE[summary.affiliateStatus ?? ""] ?? null;

  return (
    <PageFrame width="base" title="Affiliate dashboard" description="Invite friends and track what you earn from them.">
      {verified === "1" && user.emailVerified ? (
        <p role="status" className="rounded-lg border border-up/40 bg-up/10 px-3 py-2.5 text-sm text-up">
          Email verified. Your affiliate access is active.
        </p>
      ) : null}
      {verify === "invalid" && !user.emailVerified ? (
        <p role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-sm text-down">
          That verification link is invalid or has expired. Send yourself a new one below.
        </p>
      ) : null}

      <section aria-labelledby="email-status" className="rounded-xl border border-rule bg-panel p-5 phone:p-4">
        <h2 id="email-status" className="text-sm font-bold text-ink">
          Email verification
        </h2>
        {user.emailVerified ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-up">
            <span aria-hidden>✓</span> {user.email} is verified.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-2">
              Verify <span className="font-semibold text-ink">{user.email}</span> to activate your affiliate access. Open
              the link we emailed you; it works for 24 hours.
            </p>
            <ResendVerificationButton />
          </>
        )}
      </section>

      <section aria-labelledby="invite-link" className="rounded-xl border border-rule bg-panel p-5 phone:p-4">
        <h2 id="invite-link" className="text-sm font-bold text-ink">
          Invitation link
        </h2>
        <p className="mt-2 mb-4 text-xs leading-relaxed text-ink-2">
          Share this link with friends. It takes them to the regular sign-up page, and they join as regular users
          invited by you.
        </p>
        <InviteLink code={code} url={absoluteUrl(`/invite/${code}`)} />
      </section>

      <section aria-labelledby="account-status" className="rounded-xl border border-rule bg-panel p-5 phone:p-4">
        <h2 id="account-status" className="text-sm font-bold text-ink">
          Account status
        </h2>
        <dl className="mt-3 grid gap-2.5 text-sm">
          <Row label="Email" value={user.emailVerified ? "Verified" : "Not verified"} />
          <Row label="Identity (KYC)" value={KYC_LABEL[summary.kycStatus] ?? summary.kycStatus} />
          <Row label="Affiliate status" value={STATUS_LABEL[summary.affiliateStatus ?? ""] ?? "—"} />
        </dl>
        {statusNote ? <p className="mt-3 text-xs leading-relaxed text-ink-2">{statusNote}</p> : null}
      </section>

      <section aria-labelledby="your-terms" className="rounded-xl border border-rule bg-panel p-5 phone:p-4">
        <h2 id="your-terms" className="text-sm font-bold text-ink">
          Your terms
        </h2>
        <dl className="mt-3 grid gap-2.5 text-sm">
          <Row
            label="Revenue Share"
            value={t.revenueShareBps > 0 ? `${pct(t.revenueShareBps)} of net trading result` : "Not assigned yet"}
          />
          <Row label="First-deposit reward" value={`${pct(t.affiliateDepositRewardBps)} of the first qualifying deposit`} />
          <Row label="Qualifying deposit" value={`From ${whole(t.minQualifyingDepositMinor)}`} />
          <Row label="Qualifying trade" value={`From ${whole(t.minQualifyingTradeMinor)} of own money`} />
        </dl>
      </section>

      <section aria-label="Your referrals" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Total referrals" value={String(summary.totalReferrals)} note="Signed up with your link or code" />
        <Stat label="Qualified users" value={String(summary.qualifiedUsers)} note="Deposited and traded" />
        <Stat label="Total deposited" value={formatMoney(summary.totalDepositedMinor, "INR")} note="By qualified users" />
      </section>

      <ProgramEarningsPanel summary={summary} activity={activity} />
    </PageFrame>
  );
}
