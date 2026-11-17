import type { Metadata } from "next";
import Link from "next/link";
import { getProgramSettings } from "@asm/db";
import { LogoWordmark } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AffiliateMotion, AnimatedNumber } from "@/components/affiliate/AffiliateMotion";
import { EarningsCalculator } from "@/components/affiliate/EarningsCalculator";
import { SampleDashboard } from "@/components/affiliate/SampleDashboard";
import { InviteJourney } from "@/components/affiliate/InviteJourney";
import { inr } from "@/components/affiliate/numbers";
import styles from "@/components/affiliate/affiliate.module.css";
import { invitedBonusPct, invitedFirstDepositBonusPct } from "@/lib/referral";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const pct = await invitedFirstDepositBonusPct();
  return buildMetadata({
    title: "Affiliate Program",
    description: `Invite friends to ${SITE_NAME}. Your friend gets a ${pct}% first-deposit bonus. Earn a reward on each referred friend's first qualifying deposit plus a share of revenue from their trading.`,
    path: "/affiliate",
    keywords: [`${SITE_NAME} affiliate`, "trading affiliate program", "refer and earn trading"],
  });
}

function Arrow() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>;
}
function Ctas() {
  return <div className={styles.ctas}><Link href="/affiliate/register" className={styles.primary}>Become an affiliate <Arrow /></Link><Link href="/affiliate/login" className={styles.secondary}>Affiliate log in</Link></div>;
}

export default async function AffiliateLandingPage() {
  const { values } = await getProgramSettings(new Date());
  const bonus = invitedBonusPct(values.INVITE_EXTRA_BONUS_PCT);
  const minimumDeposit = values.MIN_QUALIFYING_DEPOSIT_INR_MINOR / 100;
  const minimumTrade = values.MIN_QUALIFYING_TRADE_INR_MINOR / 100;
  const faqs = [
    ["Do I need a separate account?", "Yes. Create an affiliate account and verify your email. You can use the same email as your regular trading account, but each account has its own password, balance and history. Earlier referrals and rewards stay with your regular account."],
    ["When does my friend qualify?", `Your friend must join through your invitation, make a successful real-money deposit of at least ${inr(minimumDeposit)}, and complete a real-money trade of at least ${inr(minimumTrade)}. The trade may win or lose. Signup and demo activity alone do not qualify. Self-referrals are not eligible.`],
    ["How do the two rewards work?", "You earn a one-time reward on each friend's first qualifying deposit, after they complete a qualifying trade. Eligible trading can also earn you Revenue Share. Your personal reward terms and earnings are available in your affiliate account."],
    ["Can I withdraw or trade with my earnings?", "Identity verification is required before your first earnings withdrawal or transfer into trading. Only finalised, available earnings can be used. Your affiliate account has its own trading access under the same rules as a regular account, with Program Earnings separate from your Trading Balance."],
  ];
  return (
    <div className={styles.page}>
      <header className={styles.header}><div className={`${styles.wrap} ${styles.headerInner}`}><Link href="/" aria-label={`${SITE_NAME} — home`}><LogoWordmark className="h-7" /></Link><nav aria-label="Affiliate navigation" className={styles.nav}><a href="#journey">How it works</a><a href="#dashboard">Your dashboard</a><a href="#calculator">Explore your potential</a><ThemeToggle /><Link href="/affiliate/login" className="font-bold text-ink">Affiliate log in <span aria-hidden="true" className="ml-2">↗</span></Link></nav></div></header>
      <AffiliateMotion>
        <main>
          <section className={styles.hero} aria-labelledby="affiliate-title" data-hero>
            <div className={`${styles.wrap} ${styles.heroGrid}`}>
              <div className="relative z-10">
                <p data-hero-enter className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/35 bg-brand/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-brand"><span aria-hidden="true">↗</span> The {SITE_NAME} affiliate program</p>
                <h1 id="affiliate-title" data-hero-enter aria-label={`Your friend gets a ${bonus}% first-deposit bonus`}>Your friend gets a<span className={styles.bonusNumber}><AnimatedNumber value={bonus} suffix="%" duration={2.4} /></span>first-deposit bonus.</h1>
                <p data-hero-enter className={styles.heroIntro}>A bigger start for your friends.<br />A new way to earn for you. Get a first-deposit reward <span className="font-semibold text-ink">plus Revenue Share</span> as they qualify and trade.</p>
                <div data-hero-enter><Ctas /></div>
                <a href="#journey" className="mt-6 inline-flex min-h-11 items-center gap-3 text-xs font-semibold text-ink-2 hover:text-ink">Follow the invitation <span aria-hidden="true">↓</span></a>
              </div>
              <div className={styles.heroArt} data-hero-enter>
                <div data-glow className={styles.heroGlow} aria-hidden="true" /><div className={styles.heroGridPattern} aria-hidden="true" /><div className={styles.orbit} aria-hidden="true" />
                <div data-tilt className={styles.heroTicket}>
                  <div className={styles.ticketBrand}><LogoWordmark className="h-6" /><span className="text-[9px] font-semibold uppercase tracking-wider text-ink-2">Invitation</span></div>
                  <p className="mt-6 text-xs font-medium text-ink-2">FOR YOUR FRIEND</p><p className={styles.ticketBonus}>+{bonus}<span className="text-brand">%</span></p><p className="mt-2 text-lg font-bold">Their first deposit.<br />With a bigger bonus.</p>
                  <div className={styles.ticketRule}><span className="text-[10px] uppercase tracking-widest text-ink-2">Shared by you</span><p className="mt-2 truncate text-xs font-semibold text-brand">indianxtrade.com/invite/you <span aria-hidden="true">↗</span></p></div>
                </div>
                <div data-float className={`${styles.floatCard} ${styles.floatTop}`}><span className={styles.iconTile} aria-hidden="true">↗</span><div><p className="text-xs font-bold">Your personal link</p><p className="mt-1 text-[10px] text-ink-2">One invitation. Two benefits.</p></div></div>
                <div data-float className={`${styles.floatCard} ${styles.floatBottom}`}><span className={styles.iconTile} aria-hidden="true">+</span><div><p className="text-xs font-bold">First-deposit reward</p><p className="mt-1 text-[10px] text-ink-2">Plus Revenue Share for you</p></div></div>
              </div>
            </div>
          </section>
          <div className={styles.ribbon}><div className={`${styles.wrap} ${styles.ribbonInner}`}><p><span aria-hidden="true">↗</span> Your personal invitation link</p><p><span aria-hidden="true">+</span> Reward for each qualifying friend</p><p><span aria-hidden="true">◎</span> Earnings in your own dashboard</p></div></div>
          <section id="journey" className={`${styles.wrap} ${styles.section}`} aria-labelledby="journey-title">
            <div data-reveal className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 / The invitation journey</p><h2 id="journey-title" className={styles.sectionTitle}>You share.<br /><span>Good things follow.</span></h2></div><p className={styles.sectionLead}>From your invitation link to their first trade. Here&apos;s how one connection becomes a reward.</p></div>
            <InviteJourney bonus={bonus} minimumDeposit={minimumDeposit} minimumTrade={minimumTrade} />
          </section>
          <section id="dashboard" className={`${styles.dashboardSection} ${styles.section}`} aria-labelledby="dashboard-title"><div className={styles.wrap}>
            <div data-reveal className={styles.sectionHeading}><div><p className={styles.eyebrow}>02 / Your command centre</p><h2 id="dashboard-title" className={styles.sectionTitle}>Your network.<br /><span>Your numbers.</span></h2></div><p className={styles.sectionLead}>Your link, qualified friends and earnings, together. A clear view of what&apos;s pending and what&apos;s available.</p></div>
            <SampleDashboard />
          </div></section>
          <section id="calculator" className={`${styles.wrap} ${styles.section}`} aria-labelledby="calculator-title">
            <div data-reveal className={styles.sectionHeading}><div><p className={styles.eyebrow}>03 / Make it your own</p><h2 id="calculator-title" className={styles.sectionTitle}>Small circle.<br /><span>See the potential.</span></h2></div><p className={styles.sectionLead}>Explore the potential of your invitations. Your personal reward terms are available in your affiliate account.</p></div>
            <EarningsCalculator minimumDeposit={minimumDeposit} minimumTrade={minimumTrade} />
          </section>
          <section className={`${styles.wrap} ${styles.section} !pt-0`} aria-labelledby="faq-title"><div className={styles.faq}><div data-reveal><p className={styles.eyebrow}>Before your first invitation</p><h2 id="faq-title" className={styles.sectionTitle}>Good to<br /><span>know.</span></h2></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></div></section>
          <section className={`${styles.wrap} pb-16 lg:pb-24`} aria-labelledby="join-title"><div className={styles.final} data-reveal><p className={styles.eyebrow}>Your next connection starts here</p><h2 id="join-title" className={styles.sectionTitle}>Give them a bigger start.<br /><span>Make it count for you.</span></h2><p className="mb-8 text-sm text-ink-2">Open your affiliate account. Verify your email. Share your link.</p><div className="mx-auto w-fit max-w-full"><Ctas /></div></div></section>
        </main>
      </AffiliateMotion>
      <footer className={styles.footer}><div className={styles.wrap}><div className="flex flex-wrap items-center justify-between gap-6"><Link href="/" aria-label={`${SITE_NAME} — home`}><LogoWordmark className="h-7" /></Link><nav aria-label="Site information" className="flex flex-wrap gap-x-6 text-sm text-ink-2">{([["/about", "About"], ["/security", "Security"], ["/guides", "Guides"], ["/affiliate", "Affiliate program"]] as const).map(([href, label]) => <Link className="inline-flex min-h-11 items-center hover:text-ink" key={href} href={href}>{label}</Link>)}</nav></div><p className="mt-6 max-w-4xl text-xs leading-relaxed text-ink-3">{SITE_NAME} offers high-risk trading. Most short-term traders lose money. Trade only with money you can afford to lose. Availability is restricted in some jurisdictions.</p></div></footer>
    </div>
  );
}
