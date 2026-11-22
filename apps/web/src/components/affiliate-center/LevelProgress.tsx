import { AFFILIATE_LEVELS } from "@asm/contracts";
import type { AffiliateLevelStatus } from "@asm/db";
import { Icon } from "@/components/shell/Icon";
import { LevelPopoverLink } from "./Navigation";
import { affiliateCount, depositBand } from "./presentation";
import styles from "./center.module.css";

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  return <progress className={styles.progress} aria-label={label} max={Math.max(1, max)} value={max === 0 ? 1 : Math.min(value, max)} />;
}

export function LevelGoal({ status, keep = false }: { status: AffiliateLevelStatus; keep?: boolean }) {
  const remaining = keep ? status.toKeep : status.toNextLevel;
  if (remaining === null) return <p className={styles.highestLevel}>You’re at the highest level.</p>;
  const target = status.current.level + (keep ? 0 : 1);
  const needed = AFFILIATE_LEVELS.find(({ level }) => level === target)?.minDeposits ?? 0;
  const label = keep ? `To keep Level ${target}` : `Go up to Level ${target}`;

  return (
    <div className={styles.levelGoal}>
      <div><strong>{label}</strong><span>{affiliateCount.format(remaining)} left</span></div>
      <ProgressBar value={status.monthQualifyingDeposits} max={needed} label={label} />
    </div>
  );
}

export function LevelBadge({ status }: { status: AffiliateLevelStatus | null }) {
  return (
    <>
      <button className={styles.levelBadge} type="button" popoverTarget="affiliate-level-popover" aria-label={status
        ? `Affiliate levels, current Level ${status.current.level} ${status.current.name}, projected Level ${status.next.level} ${status.next.name}`
        : "Affiliate levels"}>
        <span aria-hidden="true">⚡</span>
        {status ? (
          <>
            <span>L{status.current.level} {status.current.name}</span>
            <Icon name="chevron" className="size-3" />
            <span>L{status.next.level} {status.next.name}</span>
          </>
        ) : <span>Affiliate levels</span>}
      </button>
      <div id="affiliate-level-popover" popover="auto" className={styles.levelPopover} aria-label="Affiliate levels">
        <div className={styles.popoverHeading}>
          <h2>Affiliate levels</h2>
          <button type="button" popoverTarget="affiliate-level-popover" popoverTargetAction="hide" className={styles.iconButton} aria-label="Close affiliate levels"><Icon name="close" /></button>
        </div>
        {status ? (
          <div className={styles.levelOverview}>
            <div className={styles.levelBanner}>
              <div><span>Current level</span><strong>L{status.current.level} {status.current.name}</strong></div>
              <Icon name="chevron" />
              <div><span>Projected next month</span><strong>L{status.next.level} {status.next.name}</strong></div>
            </div>
            <div className={styles.levelGoals}>
              <p><strong>{affiliateCount.format(status.monthQualifyingDeposits)} qualifying first {status.monthQualifyingDeposits === 1 ? "deposit" : "deposits"} this month</strong></p>
              <LevelGoal status={status} keep />
              <LevelGoal status={status} />
            </div>
          </div>
        ) : <p className={styles.empty}>Your level progress is temporarily unavailable.</p>}
        <h3 className={styles.allLevelsHeading}>All levels</h3>
        <ol className={styles.levelList}>
          {AFFILIATE_LEVELS.map((level) => (
            <li key={level.level} data-affiliate-level={level.level} aria-current={status?.current.level === level.level ? "true" : undefined}>
              <span><i aria-hidden="true" />L{level.level} {level.name}</span>
              <span>{depositBand(level)} deposits</span>
            </li>
          ))}
        </ol>
        <LevelPopoverLink />
      </div>
    </>
  );
}
