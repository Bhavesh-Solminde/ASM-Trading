import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SeasonalDiwali, FestiveLights, DiwaliEntry, DiwaliWish } from "@/components/festive/SeasonalDiwali";
import Link from "next/link";
import { LogoEmblem, LogoWordmark } from "@/components/brand/Logo";
import { CinematicHero, PlatformShowcase } from "./LandingShowcase";
import { LiveCandleBand } from "./LiveCandleBand";
import { MarketingTicker } from "./MarketingTicker";
import { CountUp, Reveal } from "./motion";
import { faqs, featureBullets, howSteps, marketingAssets, testimonials } from "./marketing-data";

export function BoldLanding() {
  return (
    <SeasonalDiwali><div className="min-h-screen bg-ground text-ink">
      <BoldNav />

      <CinematicHero />

      {/* LIVE BAND — signature motion: real streaming candles above the price marquee. */}
      <LiveCandleBand />
      <MarketingTicker speedSec={30} />

      {/* WHY */}
      <section className="relative border-b border-rule">
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(50%_60%_at_50%_0%,color-mix(in_srgb,var(--color-brand)_5%,transparent),transparent_60%)]" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-28">
          <Reveal>
            <div className="text-center">
              <p className="legend text-brand">Why traders choose IndianxTrade</p>
              <h2 className="mx-auto mt-4 max-w-2xl text-[clamp(30px,7vw,64px)] font-black leading-[0.98] tracking-[-0.02em]">
                A CFD platform <span className="text-brand">built for serious</span> traders.
              </h2>
            </div>
          </Reveal>

          <ul className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featureBullets.map((f, i) => (
              <li
                key={f.title}
                className="group relative border-t border-rule bg-transparent p-6 transition hover:bg-panel/40"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-brand text-sm font-black text-brand">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-lg font-bold text-ink">{f.title}</h3>
                </div>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-2">{f.body}</p>
              </li>
))}
          </ul>
        </div>
      </section>

      {/* ASSETS */}
      <section id="markets" className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-28">
          <Reveal>
            <div className="text-center">
              <p className="legend text-brand">Markets</p>
              <h2 className="mx-auto mt-4 max-w-2xl text-[clamp(30px,7vw,64px)] font-black leading-[0.98] tracking-[-0.02em]">
                Forex. Crypto. <span className="text-brand">India indices. 24/7.</span>
              </h2>
            </div>
          </Reveal>

          <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {marketingAssets.map((a) => (
              <div
                key={a.symbol}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-rule bg-panel/60 p-5 transition hover:border-brand/40"
              >
                <span
                  className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition group-hover:opacity-100"
                  style={{ background: "linear-gradient(90deg,transparent,var(--color-brand),transparent)" }}
                />
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-ink-3">{a.kind}</p>
                    <p className="mt-1 text-sm font-bold">{a.name}</p>
                  </div>
                  <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand">
                    {a.leverage}x
                  </span>
                </div>
                <div className="mt-6 flex items-baseline justify-between">
                  <p className="led text-xl">{a.price.toFixed(a.precision)}</p>
                  <p
                    className="text-xs font-bold"
                    style={{ color: a.changePct >= 0 ? "var(--color-up)": "var(--color-down)" }}
                  >
                    {a.changePct >= 0 ? "+": "−"}{Math.abs(a.changePct).toFixed(2)}%
                  </p>
                </div>
              </div>
))}
          </div>
        </div>
      </section>

      {/* HOW */}
      <section id="how" className="relative border-b border-rule">
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_50%,color-mix(in_srgb,var(--color-up)_6%,transparent),transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-28">
          <Reveal>
            <div className="text-center">
              <p className="legend text-brand">In under two minutes</p>
              <h2 className="mx-auto mt-4 max-w-2xl text-[clamp(30px,7vw,64px)] font-black leading-[0.98] tracking-[-0.02em]">
                From signup to your first tick.
              </h2>
            </div>
          </Reveal>
          <ol className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
            {howSteps.map((s, i) => (
              <li
                key={s.n}
                className="relative rounded-3xl border border-rule bg-panel/70 p-8"
                style={{
                  background:
                    "linear-gradient(180deg,color-mix(in_srgb,var(--color-brand)_4%,var(--color-panel)),var(--color-panel))",
                }}
              >
                {i < 2 && (
                  <span aria-hidden className="absolute -right-3 top-8 hidden text-brand md:block">→</span>
)}
                <p className="font-brand text-[80px] leading-none text-brand [text-shadow:0_0_40px_color-mix(in_srgb,var(--color-brand)_50%,transparent)]">
                  {s.n}
                </p>
                <h3 className="mt-6 text-2xl font-black">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-2">{s.body}</p>
              </li>
))}
          </ol>
        </div>
      </section>

      <PlatformShowcase>
        <AppDownloads />
      </PlatformShowcase>

      {/* SOCIAL PROOF */}
      <section className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-28">
          <Reveal>
            <div className="grid grid-cols-2 divide-x divide-y divide-rule border border-rule sm:grid-cols-4 sm:divide-y-0">
              <Stat value={<CountUp to={6.2} decimals={1} suffix="M+" />} label="traders" />
              <Stat value={<CountUp to={134} />} label="countries" />
              <Stat value={<CountUp to={400} suffix="+" />} label="assets" />
              <Stat value={<CountUp to={2.4} decimals={1} prefix="$" suffix="B" />} label="traded / month" />
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <figure
                key={t.name}
                className="relative overflow-hidden rounded-2xl border border-rule bg-panel/70 p-6"
              >
                <span className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand/10 blur-2xl" />
                <div aria-hidden className="font-brand text-4xl leading-none text-brand">&ldquo;</div>
                <blockquote className="mt-3 text-base leading-relaxed text-ink">{t.quote}</blockquote>
                <figcaption className="mt-6 flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-brand text-sm font-bold text-brand-ink">
                    {t.name.charAt(0)}
                  </span>
                  <span>
                    <p className="text-sm font-bold text-ink">{t.name}</p>
                    <p className="text-xs text-ink-2">{t.role}</p>
                  </span>
                </figcaption>
              </figure>
))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-b border-rule">
        <div className="mx-auto max-w-3xl px-5 py-16 sm:px-6 md:py-28">
          <Reveal>
            <div className="text-center">
              <p className="legend text-brand">FAQ</p>
              <h2 className="mx-auto mt-3 max-w-2xl text-[clamp(30px,7vw,64px)] font-black leading-[0.98] tracking-[-0.02em]">
                Everything you're wondering.
              </h2>
            </div>
          </Reveal>
          <div className="mt-14 space-y-3">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl border border-rule bg-panel/70 p-5 transition open:border-brand/40"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold">
                  <span>{f.q}</span>
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-brand/15 text-brand transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-4 text-sm leading-relaxed text-ink-2">{f.a}</p>
              </details>
))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden border-b border-rule">
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_80%_at_50%_50%,color-mix(in_srgb,var(--color-brand)_20%,transparent),transparent_65%)]" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-8 px-5 py-20 text-center sm:px-6 md:py-32">
          <Reveal>
            <h2 className="max-w-4xl text-[clamp(38px,10vw,104px)] font-black leading-[0.9] tracking-[-0.03em]">
              Your first CFD position is <span className="text-brand">30 seconds away.</span>
            </h2>
          </Reveal>
          <p className="max-w-lg text-lg text-ink-2">
            ₹10,00,000 in demo funds. No card. Switch to live when you&apos;re ready.
          </p>
          <Link
            href="/register"
            className="mt-2 inline-flex h-16 items-center gap-2 rounded-full bg-brand px-10 text-lg font-black text-brand-ink shadow-[0_30px_80px_-20px_color-mix(in_srgb,var(--color-brand)_60%,transparent)] transition hover:scale-[1.03] hover:brightness-110"
          >
            Start now →
          </Link>
          <p className="text-[11px] uppercase tracking-widest text-ink-3">No credit card · 30-second signup</p>
        </div>
      </section>

      <BoldFooter />
    </div></SeasonalDiwali>
);
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="bg-ground p-6 text-center sm:p-8">
      <p className="font-brand text-4xl font-black leading-none text-brand sm:text-5xl">{value}</p>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-2">{label}</p>
    </div>
);
}

function AppDownloads() {
  return (
    <div id="get-the-app" className="mt-5 max-w-lg scroll-mt-24 border-t border-rule pt-4 md:mt-6">
      <h3 className="text-base font-bold">Get the app</h3>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] items-start gap-2.5">
        <a
          href="/download/app"
          className="flex min-h-[68px] items-center gap-2 rounded-xl border border-brand/50 bg-brand/10 px-3 py-2 transition-colors hover:border-brand hover:bg-brand/20 sm:min-h-16 sm:gap-3 sm:px-4"
        >
          <svg aria-hidden="true" className="size-5 shrink-0 text-brand max-[359px]:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
          </svg>
          <span>
            <span className="block text-xs text-ink-2">Android</span>
            <span className="block text-sm font-bold">Download app</span>
          </span>
        </a>
        <details className="group rounded-xl border border-rule bg-panel/70 open:border-brand/50">
          <summary className="flex min-h-[66px] cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 hover:bg-tile sm:min-h-[62px] sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden">
            <svg aria-hidden="true" className="size-5 shrink-0 text-ink-2 max-[359px]:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="3" />
              <path d="M10 18h4" />
            </svg>
            <span className="flex-1">
              <span className="block text-xs text-ink-2">iPhone</span>
              <span className="block text-sm font-bold leading-tight">Save to Home Screen</span>
            </span>
            <span aria-hidden="true" className="text-lg text-ink-2 group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-rule px-4 pb-4 pt-3 text-sm leading-relaxed text-ink-2">
            <ol className="ml-4 list-decimal space-y-2">
              <li>Open indianxtrade.com in <strong className="text-ink">Safari</strong> on your iPhone.</li>
              <li>Tap <strong className="text-ink">Share</strong> (you may need to tap the menu first).</li>
              <li>Choose <strong className="text-ink">Add to Home Screen</strong>. If you see <strong className="text-ink">Open as Web App</strong>, turn it on, then tap <strong className="text-ink">Add</strong>.</li>
            </ol>
            <p className="mt-3 text-xs">This saves the website to your Home Screen. No App Store download needed.</p>
          </div>
        </details>
      </div>
      <Link href="/download/app/install" className="mt-2 inline-block text-xs text-ink-2 underline underline-offset-4 hover:text-ink">
        How to install on Android
      </Link>
    </div>
  );
}

function BoldNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-ground/70 backdrop-blur-xl">
      <FestiveLights />
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link href="/" aria-label="IndianxTrade — home" className="flex items-center">
          <LogoWordmark className="h-7" />
        </Link>
        <div className="hidden items-center gap-8 text-sm text-ink-2 md:flex">
          <a href="#markets" className="hover:text-ink">Markets</a>
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#platform" className="hover:text-ink">Platform</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </div>
        <div className="relative flex items-center gap-2">
          <span className="inline-flex lg:absolute lg:right-full lg:top-1/2 lg:mr-2 lg:-translate-y-1/2"><ThemeToggle /></span>
          <span className="inline-flex xl:hidden"><DiwaliEntry iconOnly /></span>
          <span className="hidden xl:block"><DiwaliEntry compact /></span>
          <Link
            href="/login"
            className="hidden text-sm font-semibold text-ink-2 hover:text-ink sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="inline-flex h-9 items-center rounded-full bg-brand px-4 text-sm font-black text-brand-ink shadow-[0_10px_30px_-10px_color-mix(in_srgb,var(--color-brand)_60%,transparent)] hover:brightness-110"
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
);
}

/** Footer links that have a real page; the rest stay placeholders. */
const FOOTER_HREFS: Record<string, string> = { "Affiliate program": "/affiliate" };

function BoldFooter() {
  return (
    <footer className="bg-ground">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <DiwaliWish />
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <LogoEmblem detail className="h-20 w-20" />
            <p className="mt-4 max-w-xs text-xs leading-relaxed text-ink-3">
              SEBI-regulated CFD trading platform. Real market prices, stop-loss/take-profit on every position, up to 100x leverage. Built for serious traders.
            </p>
          </div>
          {[
            ["Product", ["Trade", "Markets", "Leverage", "Mobile"]],
            ["Company", ["About", "Regulation", "Press", "Contact", "Affiliate program"]],
            ["Support", ["Help centre", "Deposit & withdrawal", "SEBI compliance", "Risk disclosure"]],
          ].map(([h, links]) => (
            <div key={h as string}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-2">{h as string}</p>
              <ul className="mt-4 space-y-2 text-sm text-ink-2">
                {(links as string[]).map((l) => (
                  <li key={l}>
                    <a href={FOOTER_HREFS[l] ?? "#"} className="hover:text-ink">{l}</a>
                  </li>
))}
              </ul>
            </div>
))}
        </div>

        <div className="mt-12 border-t border-rule pt-8 text-[11px] leading-relaxed text-ink-3">
          <p className="font-semibold uppercase tracking-widest text-ink-2">Risk disclosure</p>
          <p className="mt-2 max-w-3xl">
            CFD trading carries substantial risk and can result in the loss of your invested capital. Past
            performance is not indicative of future results. IndianxTrade is a SEBI-registered platform.
            Leveraged products are not suitable for all investors. Please ensure you fully understand the risks
            before opening a live account.
          </p>
          <p className="mt-6">© {new Date().getFullYear()} IndianxTrade. All rights reserved.</p>
        </div>
      </div>
    </footer>
);
}
