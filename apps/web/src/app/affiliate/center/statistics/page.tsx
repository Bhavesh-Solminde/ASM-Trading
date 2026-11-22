import Link from "next/link";
import {
  formatMoney, getAffiliateStatsBy, listAffiliateLinks, listAffiliateTraders,
  type AffiliateStatsRow, type AffiliateTraderRow,
} from "@asm/db";
import { PeriodFields } from "@/components/affiliate-center/PeriodFields";
import { StatisticsTable, type StatisticColumn, type StatisticDisplayRow } from "@/components/affiliate-center/StatisticsTable";
import { affiliateCount, affiliateDate, CENTER_PATH, centerUrl } from "@/components/affiliate-center/presentation";
import { queryValue, requireAffiliate, statisticsPeriod, type CenterQuery } from "@/components/affiliate-center/server";
import { Icon } from "@/components/shell/Icon";
import styles from "@/components/affiliate-center/center.module.css";

const STATS_PATH = `${CENTER_PATH}/statistics`;
const TABS = [
  { id: "date", label: "Dates", column: "Date (IST)" },
  { id: "traders", label: "Traders", column: "Trader ID" },
  { id: "link", label: "Links", column: "Link" },
  { id: "country", label: "Countries", column: "Country" },
] as const;
const PAGE_SIZES = [10, 20, 50, 100] as const;

const MONEY_COLUMNS: StatisticColumn[] = [
  { id: "ftdSum", label: "First-deposit amount", numeric: true },
  { id: "deposits", label: "Deposits", numeric: true },
  { id: "depositsSum", label: "Deposit amount", numeric: true },
  { id: "withdrawalsSum", label: "Withdrawal amount", numeric: true },
  { id: "turnover", label: "Turnover", numeric: true },
  { id: "earnings", label: "Earnings", numeric: true },
];
const GROUPED_COLUMNS: StatisticColumn[] = [
  { id: "clicks", label: "Clicks", numeric: true },
  { id: "registrations", label: "Registrations", numeric: true },
  { id: "ftd", label: "First deposits", numeric: true },
  ...MONEY_COLUMNS.slice(0, 3),
  { id: "bonuses", label: "Bonuses", numeric: true },
  { id: "withdrawals", label: "Withdrawals", numeric: true },
  ...MONEY_COLUMNS.slice(3),
];
const TRADER_COLUMNS: StatisticColumn[] = [
  { id: "registeredAt", label: "Registered (IST)" },
  { id: "link", label: "Link" },
  { id: "country", label: "Country" },
  { id: "ftdAt", label: "First deposit (IST)" },
  ...MONEY_COLUMNS,
];
const count = (value: number) => affiliateCount.format(value);
const money = (value: number) => formatMoney(value, "INR");
const countryNames = new Intl.DisplayNames("en-IN", { type: "region", fallback: "none" });

function countryName(value: string | null): string {
  if (!value) return "Unknown";
  return /^[a-z]{2}$/i.test(value) ? countryNames.of(value.toUpperCase()) ?? value : value;
}

function groupedRow(row: AffiliateStatsRow, title: string): StatisticDisplayRow {
  return {
    key: row.key,
    title,
    cells: {
      clicks: count(row.clicks), registrations: count(row.registrations), ftd: count(row.ftdCount),
      ftdSum: money(row.ftdSumMinor), deposits: count(row.depositsCount), depositsSum: money(row.depositsSumMinor),
      bonuses: money(row.bonusesSumMinor),
      withdrawals: count(row.withdrawalsCount), withdrawalsSum: money(row.withdrawalsSumMinor),
      turnover: money(row.turnoverMinor), earnings: money(row.earningsMinor),
    },
  };
}

function traderRow(row: AffiliateTraderRow, codes: Map<string, string>): StatisticDisplayRow {
  return {
    key: row.traderId,
    title: row.traderId,
    cells: {
      registeredAt: affiliateDate.format(row.registeredAt),
      link: row.linkId ? codes.get(row.linkId) ?? "—" : "—",
      country: countryName(row.country),
      ftdAt: row.ftdAt ? affiliateDate.format(row.ftdAt) : "—",
      ftdSum: row.ftdAt ? money(row.ftdMinor) : "—",
      deposits: count(row.depositsCount), depositsSum: money(row.depositsSumMinor),
      withdrawalsSum: money(row.withdrawalsSumMinor), turnover: money(row.turnoverMinor), earnings: money(row.earningsMinor),
    },
  };
}

export default async function StatisticsPage({ searchParams }: { searchParams: Promise<CenterQuery> }) {
  const [user, query] = await Promise.all([requireAffiliate(), searchParams]);
  const tab = TABS.find(({ id }) => id === queryValue(query, "by")) ?? TABS[0];
  const period = statisticsPeriod(query, user.createdAt, new Date());
  const { range } = period;
  const requestedLink = queryValue(query, "link");
  const traderId = queryValue(query, "trader").trim().slice(0, 8).toUpperCase();
  const pageSize = PAGE_SIZES.find((size) => String(size) === queryValue(query, "size")) ?? 20;
  const requestedPage = Number(queryValue(query, "page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(1_000_000, requestedPage) : 1;
  const linksPromise = listAffiliateLinks(user.id);
  const linkId = requestedLink && (await linksPromise).some(({ id }) => id === requestedLink) ? requestedLink : undefined;
  const filter = linkId ? { linkId } : {};
  const urlFilters = {
    period: period.period,
    from: period.period === "custom" ? period.from : undefined,
    to: period.period === "custom" ? period.to : undefined,
    link: linkId,
    size: pageSize,
  };

  let activePage = page;
  let total = 0;
  let rows: StatisticDisplayRow[] = [];
  if (tab.id === "traders") {
    const fetchPage = (page: number) => listAffiliateTraders(user.id, range, {
      ...filter, ...(traderId ? { traderId } : {}), page, pageSize,
    });
    const [initial, links] = await Promise.all([fetchPage(page), linksPromise]);
    total = initial.total;
    activePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const result = activePage === page ? initial : await fetchPage(activePage);
    const codes = new Map(links.map(({ id, code }) => [id, code]));
    rows = result.rows.map((row) => traderRow(row, codes));
  } else {
    const [result, links] = await Promise.all([getAffiliateStatsBy(user.id, tab.id, range, filter), linksPromise]);
    total = result.length;
    activePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const linkLabels = new Map(links.map(({ id, code, isDefault }) => [id, isDefault ? `Default · ${code}` : code]));
    rows = result.slice((activePage - 1) * pageSize, activePage * pageSize).map((row) => {
      const title = tab.id === "country" ? countryName(row.label)
        : tab.id === "date" ? affiliateDate.format(new Date(`${row.key}T00:00:00Z`))
        : linkLabels.get(row.key) ?? row.label;
      return groupedRow(row, title);
    });
  }

  const links = await linksPromise;
  const pageUrl = (target: number) => centerUrl(STATS_PATH, { ...urlFilters, by: tab.id, page: target, trader: tab.id === "traders" ? traderId : undefined });
  const firstRow = (activePage - 1) * pageSize + 1;
  const lastRow = firstRow + rows.length - 1;

  return (
    <>
      <div className={styles.heading}>
        <h1>Statistics</h1>
        <p>Explore referrals and earnings by date, trader, link or country.</p>
      </div>
      <section className={styles.panel} aria-label="Statistics filters">
        <nav aria-label="Group statistics by" className={`${styles.segmented} mb-4`}>
          {TABS.map(({ id, label }) => (
            <Link key={id} href={centerUrl(STATS_PATH, { ...urlFilters, by: id, trader: id === "traders" ? traderId : undefined })}
              aria-current={id === tab.id ? "page" : undefined} prefetch={false}>{label}</Link>
          ))}
        </nav>
        <form className={styles.filters} action={STATS_PATH} method="get" key={`${tab.id}:${linkId ?? ""}:${traderId}:${pageSize}`}>
          <input type="hidden" name="by" value={tab.id} />
          <PeriodFields key={`${period.period}:${period.from}:${period.to}`} {...period} />
          <label>
            Link
            <select className={styles.field} name="link" defaultValue={linkId ?? ""}>
              <option value="">All links</option>
              {links.map(({ id, code, isDefault }) => <option value={id} key={id}>{isDefault ? `Default · ${code}` : code}</option>)}
            </select>
          </label>
          {tab.id === "traders" ? <label>Trader ID<input className={styles.field} type="search" name="trader" defaultValue={traderId} maxLength={8} placeholder="Trader ID" /></label> : null}
          <label>Rows per page
            <select className={styles.field} name="size" defaultValue={pageSize}>
              {PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}
            </select>
          </label>
          <button type="submit" className={styles.primary}>Apply filters</button>
        </form>
        {period.error ? <p role="alert" className={styles.filterError}>{period.error}</p> : null}
      </section>
      <section className={styles.panel} aria-label={`Statistics by ${tab.label.toLowerCase()}`}>
        <p className={`${styles.rangeNote} mb-3`}>{affiliateDate.format(range.from)} – {affiliateDate.format(new Date(range.to.getTime() - 1))} (IST)</p>
        <StatisticsTable heading={tab.column} columns={tab.id === "traders" ? TRADER_COLUMNS : GROUPED_COLUMNS}
          rows={rows} message="No results for these filters." />
        {total > 0 ? (
          <nav className={styles.tableFooter} aria-label="Statistics pages">
            <p>Showing {count(firstRow)}–{count(lastRow)} of {count(total)}</p>
            <div>
              {activePage > 1 ? <Link href={pageUrl(activePage - 1)} className={styles.secondary}><Icon name="back" className="size-4" />Previous</Link> : null}
              {lastRow < total ? <Link href={pageUrl(activePage + 1)} className={styles.secondary}>Next<Icon name="chevron" className="size-4" /></Link> : null}
            </div>
          </nav>
        ) : null}
      </section>
    </>
  );
}
