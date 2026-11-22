import Link from "next/link";
import { listAffiliateLinks } from "@asm/db";
import { NewLinkDialog } from "@/components/affiliate-center/NewLinkDialog";
import { affiliateDate, CENTER_PATH, LINK_KIND_LABELS } from "@/components/affiliate-center/presentation";
import { requireAffiliate } from "@/components/affiliate-center/server";
import { Icon } from "@/components/shell/Icon";
import { CopyButton } from "@/components/shell/InviteLink";
import { absoluteUrl } from "@/lib/site";
import styles from "@/components/affiliate-center/center.module.css";

export default async function AffiliateLinksPage() {
  const user = await requireAffiliate();
  const links = await listAffiliateLinks(user.id);

  return (
    <>
      <div className={styles.heading}><h1>Links</h1></div>
      <p className={styles.notice}>
        <Icon name="globe" />
        <span>Use a different link for each place you share your invitation. Each link tracks its own clicks and sign-ups in{" "}
          <Link href={`${CENTER_PATH}/statistics?by=link`} className={styles.textLink}>Statistics</Link>.
        </span>
      </p>
      <section className={styles.panel} aria-labelledby="tracked-links">
        <div className={`${styles.sectionHeading} mb-4`}>
          <h2 id="tracked-links">Tracked links</h2>
          <NewLinkDialog />
        </div>
        <div className={styles.tableRegion} role="region" aria-label="Tracked links table" tabIndex={0}>
          <table className={styles.table}>
            <thead><tr>{["ID", "Link", "Comment", "Type", "Created (IST)"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>
              {links.map((link) => {
                const url = absoluteUrl(link.url);
                return (
                  <tr key={link.id}>
                    <th scope="row">
                      {link.code}
                      {link.isDefault ? <small className="ml-2 rounded bg-brand-dim px-1.5 py-0.5 text-brand">Default</small> : null}
                    </th>
                    <td><div className={styles.tableLink}><span>{url}</span><CopyButton value={url} label={`Copy ${link.code}`} /></div></td>
                    <td className={styles.commentCell}>{link.comment || "—"}</td>
                    <td>{LINK_KIND_LABELS[link.kind]}</td>
                    <td>{affiliateDate.format(link.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {links.length === 0 ? <p className={styles.empty}>No links to show yet.</p> : null}
      </section>
    </>
  );
}
