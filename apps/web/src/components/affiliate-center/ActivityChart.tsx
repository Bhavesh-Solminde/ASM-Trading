import Link from "next/link";
import type { AffiliateSeriesPoint, Bucket } from "@asm/db";
import { affiliateCount, affiliateDate, affiliateMonthLabel, affiliateShortDate, CENTER_PATH, centerUrl } from "./presentation";
import styles from "./center.module.css";

const SERIES = [
  { key: "clicks", label: "Clicks", tone: 7 },
  { key: "registrations", label: "Registrations", tone: 2 },
  { key: "ftdCount", label: "First deposits", tone: 4 },
] as const;

const BUCKETS = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
] as const;

const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 160;

export function ActivityChart({ points: values, bucket, filter, range }: {
  points: AffiliateSeriesPoint[];
  bucket: Bucket;
  filter: Record<string, string | undefined>;
  range: { from: Date; to: Date };
}) {
  const hasActivity = values.some(({ clicks, registrations, ftdCount }) => clicks || registrations || ftdCount);
  const highest = values.reduce((max, { clicks, registrations, ftdCount }) => Math.max(max, clicks, registrations, ftdCount), 0);
  const ticks = Math.max(1, Math.ceil(highest / 4));
  const upper = ticks * 4;
  const first = values[0]?.start.getTime() ?? range.from.getTime();
  const last = values.at(-1)?.start.getTime() ?? range.to.getTime() - 1;
  const firstLabel = new Date(first);
  const midLabel = new Date(first + (last - first) / 2);
  const lastLabel = new Date(last);
  const formatDate = bucket === "month" ? affiliateMonthLabel : affiliateShortDate;
  const x = (point: AffiliateSeriesPoint) => first === last ? PLOT_WIDTH / 2 : PLOT_WIDTH * (point.start.getTime() - first) / (last - first);
  const y = (value: number) => PLOT_HEIGHT * (1 - value / upper);

  return (
    <section className={styles.panel} aria-labelledby="activity-chart-title">
      <div className={styles.sectionHeading}>
        <h2 id="activity-chart-title">Referral activity</h2>
        <nav aria-label="Chart interval" className={styles.segmented}>
          {BUCKETS.map(({ key, label }) => (
            <Link
              key={key}
              href={`${centerUrl(CENTER_PATH, { ...filter, bucket: key })}#activity-chart-title`}
              aria-current={bucket === key ? "true" : undefined}
              scroll={false}
              prefetch={false}
            >{label}</Link>
          ))}
        </nav>
      </div>
      <figure className={styles.chart} aria-label="Clicks, registrations and first deposits over the selected period">
        <ul className={styles.chartLegend}>
          {SERIES.map(({ key, label, tone }) => <li key={key} data-affiliate-level={tone}><span />{label}</li>)}
        </ul>
        <div className={styles.chartPlot}>
          <svg aria-hidden="true" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} preserveAspectRatio="none">
            {[0, 1, 2, 3, 4].map((row) => (
              <line key={row} x1={0} x2={PLOT_WIDTH} y1={row * PLOT_HEIGHT / 4} y2={row * PLOT_HEIGHT / 4} className={styles.chartGrid} />
            ))}
            {hasActivity ? SERIES.map(({ key, tone }) => values.length === 1 ? (
              <circle key={key} data-affiliate-level={tone} cx={x(values[0]!)} cy={y(values[0]![key])} r={3} className={styles.chartDot} />
            ) : (
              <polyline key={key} data-affiliate-level={tone} fill="none" className={styles.chartLine}
                points={values.map((point) => `${x(point).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ")} />
            )) : null}
          </svg>
          <div className={styles.chartTicks} aria-hidden="true">
            {[4, 3, 2, 1, 0].map((multiple) => <span key={multiple}>{affiliateCount.format(multiple * ticks)}</span>)}
          </div>
          <div className={styles.chartDates} aria-hidden="true">
            <span>{formatDate.format(firstLabel)}</span>
            {first !== last ? <><span>{formatDate.format(midLabel)}</span><span>{formatDate.format(lastLabel)}</span></> : null}
          </div>
          {!hasActivity ? <div className={styles.chartEmpty}><p>No activity in this period</p></div> : null}
        </div>
        {hasActivity && values.length <= 62 ? (
          <details className={styles.chartData}>
            <summary>View chart data</summary>
            <div className={styles.tableRegion}>
              <table className={styles.table}>
                <thead><tr><th scope="col">Period start (IST)</th>{SERIES.map(({ key, label }) => <th key={key} scope="col" data-numeric>{label}</th>)}</tr></thead>
                <tbody>{values.map((point) => (
                  <tr key={point.start.toISOString()}>
                    <th scope="row">{affiliateDate.format(point.start)}</th>
                    {SERIES.map(({ key }) => <td key={key} data-numeric>{affiliateCount.format(point[key])}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        ) : null}
        {hasActivity && values.length > 62 ? (
          <Link href={centerUrl(`${CENTER_PATH}/statistics`, filter)} className={styles.textLink}>View date statistics</Link>
        ) : null}
      </figure>
    </section>
  );
}
