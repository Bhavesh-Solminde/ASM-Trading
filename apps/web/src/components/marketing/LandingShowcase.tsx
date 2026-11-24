import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./LandingShowcase.module.css";

export function CinematicHero() {
  return (
    <section aria-labelledby="home-hero-title" className={styles.hero}>
      <div className="relative mx-auto w-full max-w-5xl px-4 text-center">
        <h1 id="home-hero-title" className={styles.title}>
          Explore the markets.<br />Trade in demo.
        </h1>
        <Link
          href="/register"
          className="mt-6 inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-brand-fill px-7 text-sm font-bold text-brand-ink hover:bg-brand-fill-hi sm:mt-8 sm:min-h-14 sm:text-base"
        >
          Start free demo <span aria-hidden="true">↗</span>
        </Link>
        <p className="mt-3 text-xs font-semibold sm:text-sm">
          Live CFD trading puts your capital at risk.
        </p>
      </div>
    </section>
  );
}

const deviceScreens = {
  desktop: {
    width: 1440,
    height: 900,
    sizes: "(max-width: 767px) 75vw, (max-width: 1152px) 72vw, 805px",
    alt: "IndianxTrade desktop demo with a market watchlist, chart and trade ticket",
  },
  phone: {
    width: 390,
    height: 844,
    sizes: "(max-width: 767px) 28vw, (max-width: 1152px) 23vw, 230px",
    alt: "IndianxTrade mobile demo with a chart and Buy and Sell controls",
  },
} as const;

function DashboardScreen({ device }: { device: keyof typeof deviceScreens }) {
  const screen = deviceScreens[device];
  return (
    <div className={styles.screen}>
      <Image {...screen} src={`/marketing/dashboard-${device}-dark.webp`} className={styles.darkScreen} />
      <Image {...screen} src={`/marketing/dashboard-${device}-light.webp`} className={styles.lightScreen} />
    </div>
  );
}

export function PlatformShowcase({ children }: { children: ReactNode }) {
  return (
    <section id="platform" aria-labelledby="showcase-title" className="scroll-mt-16 border-b border-rule">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-28">
        <figure>
          <div className={styles.deviceStage}>
            <div className={styles.monitor}>
              <div className={styles.monitorFrame}><DashboardScreen device="desktop" /></div>
              <div className={styles.monitorStand} aria-hidden="true" />
            </div>
            <div className={styles.phone}>
              <DashboardScreen device="phone" />
            </div>
          </div>
          <figcaption className="mt-3 text-right text-xs text-ink-2">
            IndianxTrade demo workspace on desktop and mobile web with sample market data
          </figcaption>
        </figure>
        <div className="mt-6 sm:mt-9">
          <h2 id="showcase-title" className="text-balance text-[clamp(32px,6vw,60px)] font-black leading-[0.98] tracking-tight">
            At your desk.<br />On your phone.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-2">
            See the chart and trade ticket side by side on desktop. On your phone, keep the chart
            and order controls within reach.
          </p>
          {children}
        </div>
      </div>
    </section>
  );
}
