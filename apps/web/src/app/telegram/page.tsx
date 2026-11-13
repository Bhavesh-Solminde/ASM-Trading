import Image from "next/image";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import styles from "./telegram.module.css";

const handle = "nikhiltrd";
const channelName = "Trade with Nikhil";
const channelUrl = `https://t.me/${handle}`;
const artwork = "/marketing/telegram-market-flight.webp";

export const metadata = buildMetadata({
  title: `${channelName} on Telegram`,
  description: "Follow Trade with Nikhil on Telegram for Indian market perspectives and chart breakdowns.",
  path: "/telegram",
  image: artwork,
});

const topics = [
  {
    title: "Market commentary",
    description: "Get a trader’s perspective on what’s moving Indian markets.",
    icon: "M3 17l6-6 4 4 7-8m-5 0h5v5",
  },
  {
    title: "Chart breakdowns",
    description: "Look closer at price action, key levels, and how setups take shape.",
    icon: "M6 3v4m0 8v6m6-18v8m0 6v4m6-18v2m0 8v8M4 7h4v8H4zm6 4h4v6h-4zm6-6h4v8h-4z",
  },
  {
    title: "Updates on Telegram",
    description: "Read posts in the app and choose when to get notified.",
    icon: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0",
  },
];

function TelegramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.94 3.32a1 1 0 0 0-1.03-.14L2.64 10.2c-.9.35-.89 1.61.02 1.93l4.63 1.62 1.78 5.34c.2.6.96.8 1.42.36l2.55-2.46 4.7 3.45c.56.41 1.36.1 1.5-.58l3.09-15.53a1 1 0 0 0-.39-1.01Zm-4 3.76-8.1 7.16-.32 2.75-1.12-3.92 9.14-6.54c.35-.25.71.26.4.55Z" />
    </svg>
  );
}

function ExternalArrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18 18 6M8 6h10v10" />
    </svg>
  );
}

function JoinLink({ compact = false }: { compact?: boolean }) {
  return (
    <a className={compact ? `${styles.join} ${styles.compactJoin}` : styles.join} href={channelUrl}>
      <TelegramIcon />
      Join on Telegram
    </a>
  );
}

function BrandLink() {
  return (
    <Link href="/" className={styles.brand}>
      <Image src="/brand/indianxtrade-mark-light.png" width={175} height={120} alt="" />
      IndianxTrade
    </Link>
  );
}

export default function TelegramPage() {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <div className={`${styles.shell} ${styles.headerInner}`}>
          <BrandLink />
          <nav aria-label="Page navigation">
            <a href="#channel">The channel</a>
            <a href="#what-you-get">What you’ll get</a>
          </nav>
          <JoinLink compact />
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className={`${styles.shell} ${styles.hero}`} aria-labelledby="hero-title">
          <div className={styles.intro}>
            <p className={styles.kicker}><span aria-hidden="true" /> Indian market commentary</p>
            <h1 id="hero-title">A clearer read on the market.</h1>
            <p className={styles.summary}>Follow <strong>{channelName}</strong> on Telegram for Indian market perspectives and chart breakdowns.</p>
            <JoinLink />
          </div>

          <div className={styles.channel} id="channel">
            <Image
              className={styles.artwork}
              src={artwork}
              alt=""
              fill
              sizes="(min-width: 87rem) 655px, (min-width: 54rem) 48vw, 92vw"
              loading="eager"
              fetchPriority="high"
            />
            <a className={styles.channelLink} href={channelUrl} aria-label={`Open ${channelName} on Telegram`}>
              <span className={styles.channelIcon}><TelegramIcon /></span>
              <span className={styles.channelIdentity}>
                <strong>{channelName}</strong>
                <span>@{handle}</span>
              </span>
              <span className={styles.channelArrow}><ExternalArrow /></span>
            </a>
          </div>
        </section>

        <section className={styles.benefits} id="what-you-get" aria-labelledby="benefits-title">
          <div className={styles.shell}>
            <h2 id="benefits-title">What you’ll get in the channel</h2>
            <ul className={styles.topics} role="list">
              {topics.map(({ title, description, icon }) => (
                <li key={title}>
                  <span className={styles.topicIcon}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d={icon} />
                    </svg>
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className={`${styles.shell} ${styles.footer}`}>
        <BrandLink />
        <a href={channelUrl}>@{handle} <ExternalArrow /></a>
      </footer>
    </div>
  );
}
