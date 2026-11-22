import { AFFILIATE_LEVELS } from "@asm/contracts";
import { listLevelTerms } from "@asm/db";
import { ProgressBar } from "@/components/affiliate-center/LevelProgress";
import { depositBand } from "@/components/affiliate-center/presentation";
import { readAffiliateSummary, requireAffiliate } from "@/components/affiliate-center/server";
import { Icon } from "@/components/shell/Icon";
import styles from "@/components/affiliate-center/center.module.css";

const revenueShare = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 2 });
const highestThreshold = AFFILIATE_LEVELS.at(-1)!.minDeposits;

function LevelIcon({ level }: { level: number }) {
  if (level <= 3) return <Icon name="user" className="size-6" />;
  if (level === 4) return <Icon name="star" className="size-6" />;
  if (level === 6) return <Icon name="cup" className="size-6" />;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
      {level === 5
        ? <path d="M12 2.5 14.6 9.4 21.5 12l-6.9 2.6-2.6 6.9-2.6-6.9L2.5 12l6.9-2.6L12 2.5ZM19 3v4m-2-2h4" />
        : <path d="M3 7l4 3 5-5 5 5 4-3-2 10H5L3 7Zm3 13h12" />}
    </svg>
  );
}

export default async function AffiliateLevelsPage() {
  const user = await requireAffiliate();
  const [summary, terms] = await Promise.all([readAffiliateSummary(user.id), listLevelTerms()]);
  const termsByLevel = new Map(terms.map(({ level, revenueShareBps }) => [level, revenueShareBps]));

  return (
    <>
      <div className={styles.heading}>
        <h1>Levels</h1>
        <p>You start at Level 1. At the start of each month, your level can go up or down based on how many referrals made a qualifying first deposit in the previous month.</p>
      </div>
      <div className={styles.levelsGrid}>
        {AFFILIATE_LEVELS.map((level) => {
          const current = level.level === summary.levelStatus?.current.level;
          const bps = termsByLevel.get(level.level);
          return (
            <article className={`${styles.panel} ${styles.levelCard}`} data-affiliate-level={level.level} data-current={current} key={level.level}>
              <div className={styles.levelCardTop}>
                <span>Level {level.level}</span>
                {current ? <span>Current level</span> : null}
              </div>
              <div className={styles.levelCardName}>
                <span className={styles.levelIcon}><LevelIcon level={level.level} /></span>
                <h2>{level.name}</h2>
              </div>
              <div className={styles.levelMetric}>
                <div>Deposits required <strong>{depositBand(level)}</strong></div>
                <ProgressBar value={level.maxDeposits ?? highestThreshold} max={highestThreshold} label={`Level ${level.level} deposit band`} />
              </div>
              <div className={styles.levelMetric}>
                <div>Revenue Share <strong>{bps === undefined ? "—" : revenueShare.format(bps / 10_000)}</strong></div>
                {bps === undefined ? null : <ProgressBar value={bps} max={10_000} label={`Level ${level.level} Revenue Share`} />}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
