import Image from "next/image";
import styles from "./affiliate.module.css";

/** Captured from the actual signed-in dashboard with a local example account.
 * Account verification and private terms panels are omitted from this public crop. */
export function SampleDashboard() {
  return (
    <figure className={styles.dashboard} data-reveal>
      <div className={styles.windowBar}><span>Inside your affiliate account</span><span className={styles.sample}>Example dashboard</span></div>
      <a href="/affiliate/workspace-preview-cropped.png" target="_blank" rel="noreferrer" className={styles.dashboardScreenshot} aria-label="Open the real affiliate dashboard screenshot at full size (new tab)">
        <picture><source media="(max-width: 639px)" srcSet="/affiliate/workspace-preview-mobile-cropped.png" width={780} height={2168} /><Image src="/affiliate/workspace-preview-cropped.png" alt="The actual affiliate dashboard showing an example account’s app header, invitation link, referral totals and earnings balances." width={2880} height={1570} sizes="(max-width: 1200px) 100vw, 1152px" /></picture>
      </a>
      <figcaption className={styles.dashboardCaption}><span>Actual dashboard · New example account · Personal terms omitted</span><a href="/affiliate/workspace-preview-cropped.png" target="_blank" rel="noreferrer">View full size <span aria-hidden="true">↗</span></a></figcaption>
    </figure>
  );
}
