import Link from "next/link";
import { cookies } from "next/headers";
import { StartTheme, StartThemeToggle } from "@/components/acquisition/StartTheme";
import { LogoWordmark } from "@/components/brand/Logo";
import { MarketPreview } from "@/components/acquisition/MarketPreview";
import { StartLink } from "@/components/acquisition/StartLink";
import { MetaPixel } from "@/components/seo/MetaPixel";
import { metaPixelIds } from "@/lib/meta-pixel";
import { registrationHref } from "@/lib/ad-landing";
import { buildMetadata } from "@/lib/seo";
import styles from "./start.module.css";

export const dynamic = "force-dynamic";
export const metadata = buildMetadata({
  title: "Get started",
  description: "Get to know IndianxTrade. Explore forex, crypto and India indices, practise with a demo account, and start at your own pace.",
  path: "/start",
  noindex: true,
});

export default async function StartPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const href = registrationHref(params);
  const savedTheme = cookieStore.get("ixt_start_theme")?.value;
  const initialTheme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : null;
  return (
    <StartTheme initialTheme={initialTheme}>
      <a className={styles.skip} href="#introduction">Skip to content</a>
      <header className={styles.header}>
        <LogoWordmark compact className={styles.wordmark ?? ""} />
        <div className={styles.headerActions}>
          <StartThemeToggle />
          <StartLink href={href} placement="header" className={styles.headerCta ?? ""} />
        </div>
      </header>
      <main id="introduction">
        <section className={styles.hero}>
          <div className={styles.intro}>
            <p className={styles.kicker}><span aria-hidden="true" /> A world of markets. One workspace.</p>
            <h1>The markets.<br />On your terms.</h1>
            <p className={styles.summary}>Explore forex, crypto, gold and India indices. Practise with a demo, then make your next move.</p>
            <div className={styles.heroActions}><StartLink href={href} placement="hero" className={styles.primaryCta ?? ""} /><a href="#how-it-works" className={styles.textLink}>Take a closer look <span aria-hidden="true">↓</span></a></div>
            {/* Figures verified against packages/db/src/catalogue.ts and repositories/account.ts. */}
            <dl className={styles.platformNumbers} aria-label="Platform at a glance">
              <div><dt>Listed markets</dt><dd>19</dd></div>
              <div><dt>Asset classes</dt><dd>4</dd></div>
              <div><dt>Virtual demo funds</dt><dd>₹10 lakh</dd></div>
            </dl>
          </div>
          <MarketPreview />
        </section>
        <section className={styles.marketStrip} aria-label="Markets available on IndianxTrade">
          <p>One account.<br /><strong>More to explore.</strong></p>
          <div><span className={styles.assetMark}>€ / $</span><div><h2>Forex</h2><p>Global currency pairs</p></div></div>
          <div><span className={styles.assetMark}>₿</span><div><h2>Crypto</h2><p>Digital asset markets</p></div></div>
          <div><span className={styles.assetMark}>N50</span><div><h2>India indices</h2><p>Familiar market benchmarks</p></div></div>
        </section>
        <section className={styles.details} id="how-it-works" aria-labelledby="practice-heading">
          <div className={styles.detailIntro}><p>A considered way to begin</p><h2 id="practice-heading">Get comfortable.<br />Then get going.</h2><p>Good decisions start with understanding. Give yourself the space to learn the platform.</p></div>
          <ol className={styles.steps}>
            <li><span>01</span><div><h3>Step inside the platform</h3><p>Get started to create your IndianxTrade account. Already registered? Log in from the registration page.</p></div></li>
            <li><span>02</span><div><h3>Find your rhythm in demo</h3><p>Explore the charts and practise with virtual funds before putting real money on the line.</p></div></li>
            <li><span>03</span><div><h3>Make your own next move</h3><p>Choose a market, understand the trade details and decide when you’re ready.</p></div></li>
          </ol>
        </section>
        <section className={styles.closing} aria-labelledby="next-step">
          <div><p>Your workspace is waiting.</p><h2 id="next-step">A clearer view.<br />Your next move.</h2></div>
          <StartLink href={href} placement="closing" className={styles.primaryCta ?? ""} />
        </section>
      </main>
      <footer className={styles.footer}>
        <p id="trading-risk">Trading involves risk. You can lose the amount you trade. Demo results do not guarantee real trading results. Only trade with money you can afford to lose.</p>
        <div><span>IndianxTrade</span><nav aria-label="Legal"><Link href="/about">About</Link><Link href="/security">Security</Link><a href="#trading-risk">Trading risk</a></nav></div>
      </footer>
      <MetaPixel pixelIds={metaPixelIds()} />
    </StartTheme>
  );
}
