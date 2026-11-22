import Link from "next/link";
import {
  ensureReferralCode, formatMoney, getAffiliateEarningsTotal, getAffiliateSeries, getAffiliateTotals, type AffiliateTotals,
} from "@asm/db";
import { ActivityChart } from "@/components/affiliate-center/ActivityChart";
import { AffiliateAccountNotices } from "@/components/affiliate-center/AccountNotices";
import { PeriodFields } from "@/components/affiliate-center/PeriodFields";
import { affiliateCount, affiliateDate, CENTER_PATH, centerUrl } from "@/components/affiliate-center/presentation";
import {
  affiliateAllTime, chartBucket, queryValue, readAffiliateSummary, requireAffiliate, statisticsPeriod, type CenterQuery,
} from "@/components/affiliate-center/server";
import { Icon, type IconName } from "@/components/shell/Icon";
import { InviteLink } from "@/components/shell/InviteLink";
import { absoluteUrl } from "@/lib/site";
import styles from "@/components/affiliate-center/center.module.css";

const SHORTCUTS: { path: string; name: string; icon: IconName; tone: number }[] = [
  { path: "links", name: "Links", icon: "globe", tone: 2 },
  { path: "levels", name: "Levels", icon: "cup", tone: 4 },
  { path: "withdrawal", name: "Withdrawal", icon: "wallet", tone: 1 },
  { path: "faq", name: "FAQ", icon: "help", tone: 7 },
];

const money = (minor: number) => formatMoney(minor, "INR");
const count = (value: number) => affiliateCount.format(value);

function StatisticsCards({ totals }: { totals: AffiliateTotals }) {
  const metrics = [
    { title: "Deposits", value: money(totals.depositsSumMinor), count: totals.depositsCount, unit: "deposit", tone: 2 },
    { title: "Withdrawals", value: money(totals.withdrawalsSumMinor), count: totals.withdrawalsCount, unit: "withdrawal", tone: 1 },
    { title: "First deposits", value: money(totals.ftdSumMinor), count: totals.ftdCount, unit: "first deposit", tone: 4 },
    { title: "Clicks", value: count(totals.clicks), tone: 7 },
    { title: "Registrations", value: count(totals.registrations), tone: 2 },
  ];
  return (
    <dl className={styles.metricGrid}>
      {metrics.map((metric) => (
        <div className={styles.metric} data-affiliate-level={metric.tone} key={metric.title}>
          <dt>{metric.title}</dt>
          <dd>
            {metric.value}
            {metric.count !== undefined ? <small>{count(metric.count)} {metric.unit}{metric.count === 1 ? "" : "s"}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AffiliateCenterDashboard({ searchParams }: { searchParams: Promise<CenterQuery> }) {
  const [user, query] = await Promise.all([requireAffiliate(), searchParams]);
  const now = new Date();
  const period = statisticsPeriod(query, user.createdAt, now);
  const { range } = period;
  const lifetime = affiliateAllTime(user.createdAt, now);
  const chartRange = period.period === "custom" && range.from < lifetime.from ? { ...range, from: lifetime.from } : range;
  const chartFilter = { period: period.period, from: period.period === "custom" ? period.from : undefined, to: period.period === "custom" ? period.to : undefined };
  const bucket = chartBucket(query, (range.to.getTime() - range.from.getTime()) / 86_400_000);
  const [summary, code, allTimeEarnings, totals, series] = await Promise.all([
    readAffiliateSummary(user.id),
    ensureReferralCode(user.id),
    getAffiliateEarningsTotal(user.id, lifetime),
    getAffiliateTotals(user.id, range),
    chartRange.from < chartRange.to ? getAffiliateSeries(user.id, chartRange, bucket) : Promise.resolve([]),
  ]);

  return (
    <>
      <div className={styles.heading}>
        <h1>Dashboard</h1>
        <p>Track your referrals, earnings and level progress.</p>
      </div>
      <AffiliateAccountNotices email={user.email} emailVerified={user.emailVerified} status={summary.affiliateStatus}
        verified={queryValue(query, "verified")} verify={queryValue(query, "verify")} />
      <div className={styles.summaryGrid}>
        <section className={`${styles.panel} ${styles.balanceCard}`} aria-labelledby="available-balance">
          <h2 id="available-balance"><Icon name="wallet" />Available balance</h2>
          <div>
            <strong>{money(summary.availableMinor)}</strong>
            <Link className={styles.primary} href={`${CENTER_PATH}/withdrawal`}>Go to Withdrawal <Icon name="chevron" className="size-4" /></Link>
          </div>
          <p>Earnings for all time <strong>{money(allTimeEarnings)}</strong></p>
        </section>
        <section className={`${styles.panel} ${styles.shortcuts}`} aria-labelledby="shortcuts">
          <h2 id="shortcuts">Shortcuts</h2>
          <div className={styles.shortcutGrid}>
            {SHORTCUTS.map(({ path, name, icon, tone }) => (
              <Link href={`${CENTER_PATH}/${path}`} data-affiliate-level={tone} key={path}>
                <span className={styles.shortcutIcon}><Icon name={icon} /></span>
                {name}
                <Icon name="chevron" className="size-4" />
              </Link>
            ))}
          </div>
        </section>
      </div>
      <section className={styles.statistics} aria-labelledby="dashboard-statistics">
        <div className={styles.sectionHeading}>
          <h2 id="dashboard-statistics">Statistics</h2>
          <Link className={styles.textLink} href={centerUrl(`${CENTER_PATH}/statistics`, chartFilter)}>All statistics <Icon name="chevron" className="size-4" /></Link>
        </div>
        <form className={styles.filters} action={CENTER_PATH} method="get">
          <input name="bucket" type="hidden" value={queryValue(query, "bucket")} />
          <PeriodFields key={`${period.period}:${period.from}:${period.to}`} {...period} />
          <button type="submit" className={styles.secondary}>Apply</button>
          <p className={styles.rangeNote}>{affiliateDate.format(range.from)} – {affiliateDate.format(new Date(range.to.getTime() - 1))} (IST)</p>
        </form>
        {period.error ? <p role="alert" className={styles.filterError}>{period.error}</p> : null}
        <StatisticsCards totals={totals} />
        <ActivityChart points={series} bucket={bucket} filter={chartFilter} range={range} />
      </section>
      <section className={`${styles.panel} ${styles.invitePanel}`} aria-labelledby="invitation-link">
        <div>
          <h2 id="invitation-link">Invitation link</h2>
          <p>Share this link to send new referrals to sign up.</p>
        </div>
        <InviteLink code={code} url={absoluteUrl(`/invite/${code}`)} />
      </section>
    </>
  );
}
