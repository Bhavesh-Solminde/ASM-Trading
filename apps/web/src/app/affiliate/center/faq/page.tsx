import Link from "next/link";
import { Questions, type Question } from "@/components/affiliate-center/Questions";
import { CENTER_PATH } from "@/components/affiliate-center/presentation";
import { requireAffiliate } from "@/components/affiliate-center/server";
import { Icon, type IconName } from "@/components/shell/Icon";
import styles from "@/components/affiliate-center/center.module.css";

const GROUPS: { title: string; icon: IconName; questions: Question[] }[] = [
  {
    title: "General", icon: "help", questions: [
      { question: "How do I earn as an affiliate?", answer: "Share your invitation link. You can earn a reward on a qualifying first deposit and Revenue Share based on the net trading results of the people you refer." },
      { question: "How does my level change?", answer: <>Your <Link href={`${CENTER_PATH}/levels`}>level</Link> starts at Level 1 and is set monthly from the previous month’s qualifying first deposits. It can rise or fall.</> },
    ],
  },
  {
    title: "Links", icon: "globe", questions: [
      { question: "Where do I find my invitation link?", answer: <>Copy it from the Dashboard. Go to <Link href={`${CENTER_PATH}/links`}>Links</Link> to create separate tracked links for the home page, sign-up page or app download.</> },
      { question: "Why use a different link each time?", answer: "Use a different link for each channel or campaign so you can see which ones get clicks and lead to sign-ups." },
      { question: "Can I refer myself?", answer: "Self-referrals do not earn rewards or count towards your level." },
    ],
  },
  {
    title: "Withdrawals", icon: "wallet", questions: [
      { question: "How can I move or withdraw my earnings?", answer: <>Open <Link href={`${CENTER_PATH}/withdrawal`}>Withdrawal</Link> to transfer available earnings to your live trading balance or request a payout. The page shows the current minimum and withdrawal limits.</> },
      { question: "When are earnings available?", answer: "Pending earnings can become available after the day closes at midnight India time. Earnings under review stay on hold until the review is complete." },
    ],
  },
  {
    title: "Statistics", icon: "trade", questions: [
      { question: "What is a first deposit?", answer: "Statistics show the first credited live deposit for each referred trader. For your level, that deposit also needs to meet the minimum amount in effect when it was credited." },
      { question: "How do I find a specific trader?", answer: <>In <Link href={`${CENTER_PATH}/statistics?by=traders`}>Statistics → Traders</Link>, use the short trader ID and select a period. Statistics use India time.</> },
    ],
  },
  {
    title: "Account", icon: "user", questions: [
      { question: "Do affiliates need identity verification?", answer: "Verification (KYC) is not required for affiliates when moving or withdrawing affiliate earnings. We may ask you to confirm ownership of a payout method. Withdrawals from your own trading account still require identity verification." },
      { question: "How do I verify my email address?", answer: "Open the link in your verification email. If the link has expired, you can resend it from the dashboard." },
    ],
  },
  {
    title: "Support", icon: "shield", questions: [
      { question: "How do I contact support?", answer: <>Open <Link href="/support">Support</Link>. For a question about a payout, include the withdrawal ID or the date and amount so we can find it.</> },
    ],
  },
];

export default async function AffiliateFaqPage() {
  await requireAffiliate();
  return (
    <>
      <div className={styles.heading}>
        <h1>Frequently asked questions</h1>
      </div>
      <div className={styles.faqGrid}>
        {GROUPS.map(({ title, icon, questions }) => (
          <section key={title} className={styles.panel} aria-label={title}>
            <h2><Icon name={icon} />{title}</h2>
            <Questions items={questions} />
          </section>
        ))}
      </div>
    </>
  );
}
