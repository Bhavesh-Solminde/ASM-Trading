import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney, getAffiliateEarningsTotal } from "@asm/db";
import { CenterHeaderActions, CenterMobileNavigation, CenterSidebar } from "@/components/affiliate-center/Navigation";
import { LevelBadge } from "@/components/affiliate-center/LevelProgress";
import { CENTER_PATH } from "@/components/affiliate-center/presentation";
import { affiliateMonth, readAffiliateSummary, requireAffiliate } from "@/components/affiliate-center/server";
import { Icon } from "@/components/shell/Icon";
import styles from "@/components/affiliate-center/center.module.css";

export const metadata: Metadata = { title: "Affiliate Center", robots: { index: false, follow: false } };

export default async function AffiliateCenterLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAffiliate();
  const now = new Date();
  const [summary, monthEarnings] = await Promise.all([
    readAffiliateSummary(user.id),
    getAffiliateEarningsTotal(user.id, affiliateMonth(now)),
  ]);
  const money = (minor: number) => formatMoney(minor, "INR");

  return (
    <div className={styles.shell}>
      <a className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:m-3 focus:rounded-lg focus:bg-panel focus:p-3" href="#affiliate-center-content">Skip to content</a>
      <CenterSidebar />
      <div className={styles.shellBody}>
        <header className={styles.header}>
          <CenterMobileNavigation />
          <div className={styles.headerMoney}>
            <Link href={`${CENTER_PATH}/withdrawal`} className={styles.balanceLink} aria-label={`Available balance ${money(summary.availableMinor)}. Go to Withdrawal`}>
              <div><span>Available balance</span><strong>{money(summary.availableMinor)}</strong></div>
              <Icon name="chevron" className="size-4" />
            </Link>
            <div className={styles.monthEarnings}>
              <span>This month</span>
              <strong>{money(monthEarnings)}</strong>
            </div>
          </div>
          <CenterHeaderActions email={user.email} shortId={user.id.slice(0, 8).toUpperCase()}>
            <LevelBadge status={summary.levelStatus} />
          </CenterHeaderActions>
        </header>
        <main id="affiliate-center-content" className={styles.main} tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
