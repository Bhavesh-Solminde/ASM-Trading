import type { Metadata } from "next";
import Link from "next/link";
import { ensureReferralCode, formatMoney, getAffiliateEarningsTotal, getAffiliateTotals } from "@asm/db";
import { AffiliateAccountNotices } from "@/components/affiliate-center/AccountNotices";
import { LevelGoal } from "@/components/affiliate-center/LevelProgress";
import { affiliateCount, CENTER_PATH } from "@/components/affiliate-center/presentation";
import {
  affiliateAllTime, affiliateMonth, readAffiliateSummary, requireAffiliate,
} from "@/components/affiliate-center/server";
import { Icon } from "@/components/shell/Icon";
import { InviteLink } from "@/components/shell/InviteLink";
import { PageFrame } from "@/components/shell/PageFrame";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Affiliate dashboard", robots: { index: false, follow: false } };

const money = (minor: number) => formatMoney(minor, "INR");

export default async function AffiliateDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; verify?: string }>;
}) {
  const [user, { verified, verify }] = await Promise.all([requireAffiliate("/referral"), searchParams]);
  const now = new Date();
  const [code, summary, month, allTimeEarnings] = await Promise.all([
    ensureReferralCode(user.id),
    readAffiliateSummary(user.id),
    getAffiliateTotals(user.id, affiliateMonth(now)),
    getAffiliateEarningsTotal(user.id, affiliateAllTime(user.createdAt, now)),
  ]);
  const status = summary.levelStatus;
  const metrics = [
    { title: "Available balance", value: money(summary.availableMinor) },
    { title: "All-time earnings", value: money(allTimeEarnings) },
    { title: "Referrals this month", value: affiliateCount.format(month.registrations) },
    { title: "First deposits this month", value: affiliateCount.format(month.ftdCount) },
  ];

  return (
    <PageFrame width="base" title="Affiliate dashboard" description="Invite friends and see how your referrals are doing.">
      <AffiliateAccountNotices email={user.email} emailVerified={user.emailVerified}
        status={summary.affiliateStatus} verified={verified} verify={verify} />
      <dl className="grid grid-cols-2 gap-3">
        {metrics.map(({ title, value }) => (
          <div className="grid content-start gap-2 rounded-xl border border-rule bg-panel p-4" key={title}>
            <dt className="text-xs font-semibold text-ink-2">{title}</dt>
            <dd className="text-xl font-bold break-all tracking-tight tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="grid gap-4 rounded-xl border border-rule bg-panel p-5 phone:p-4" aria-labelledby="your-level">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-dim text-brand"><Icon name="cup" /></span>
          <div>
            <h2 id="your-level" className="text-xs font-semibold text-ink-2">Your level</h2>
            <p className="text-base font-bold">{status ? `Level ${status.current.level} · ${status.current.name}` : "Level progress unavailable"}</p>
          </div>
        </div>
        {status ? <LevelGoal status={status} /> : null}
      </section>
      <section aria-labelledby="invite-link" className="rounded-xl border border-rule bg-panel p-5 phone:p-4">
        <h2 id="invite-link" className="mb-3 text-sm font-bold text-ink">Invitation link</h2>
        <InviteLink code={code} url={absoluteUrl(`/invite/${code}`)} />
      </section>
      <Link href={CENTER_PATH} prefetch={false}
        className="flex min-h-13 items-center justify-center gap-2 rounded-xl bg-brand-fill px-4 py-3 text-center text-sm font-bold text-brand-ink hover:bg-brand-fill-hi">
        Open Affiliate Dashboard <Icon name="chevron" />
      </Link>
    </PageFrame>
  );
}
