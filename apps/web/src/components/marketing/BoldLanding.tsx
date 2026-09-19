import Image from "next/image";
import Link from "next/link";
import { LiveCandleBand } from "./LiveCandleBand";
import { MarketingTicker } from "./MarketingTicker";
import { CountUp, Reveal } from "./motion";
import { faqs, featureBullets, howSteps, marketingAssets, testimonials } from "./marketing-data";

/** sizes prop for editorial images: mobile hides them via `hidden md:block`,
 *  so we ask Next for a very small mobile variant to keep the srcset light. */
const editorialSizes = "(min-width: 1280px) 40vw, (min-width: 768px) 45vw, 1px";

/** Bolder Pocket-Option-style: gradients, glow, motion, heavier scale. */
export function BoldLanding() {
  return (
    <div className="min-h-screen bg-ground text-ink">
      <BoldNav />

      {/* HERO */}
      <section className="relative overflow-hidden">
        {/* colored ambient background */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 top-0 h-[520px] w-[520px] rounded-full opacity-20 blur-[120px] [background:radial-gradient(circle,color-mix(in_srgb,var(--color-brand)_60%,transparent),transparent_65%)]" />
          <div className="absolute right-[-160px] top-40 h-[480px] w-[480px] rounded-full opacity-15 blur-[120px] [background:radial-gradient(circle,color-mix(in_srgb,var(--color-up)_60%,transparent),transparent_65%)]" />
          <div
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                "linear-gradient(var(--color-rule) 1px,transparent 1px),linear-gradient(90deg,var(--color-rule) 1px,transparent 1px)",
              backgroundSize: "48px 48px",
              maskImage: "radial-gradient(60% 50% at 50% 30%, black, transparent)",
            }}
          />
        </div>

        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-5 pb-14 pt-16 sm:px-6 md:grid-cols-[minmax(0,1fr)_360px] md:gap-16 md:pb-28 md:pt-32 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-brand md:text-[11px]">
              <span aria-hidden className="dir-mark" data-dir="up" style={{ color: "var(--color-brand)", width: 8, height: 8 }} />
              50% deposit bonus · today only
            </span>
            <h1 className="mt-5 text-[clamp(40px,10vw,104px)] font-black leading-[0.92] tracking-[-0.03em] md:mt-6">
              Feel the tick.
              <br />
              <span className="bg-[linear-gradient(90deg,var(--color-brand),color-mix(in_srgb,var(--color-brand)_40%,var(--color-up)))] bg-clip-text text-transparent">
                Trade every market.
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-2 md:mt-6 md:text-lg">
              UP or DOWN. 15 seconds to end-of-day. Fixed risk, up to 95% payout, real streaming prices from our
              matching engine. Start with a $10,000 demo — no card, no wait.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center md:mt-8">
              <Link
                href="/register"
                className="group relative inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-full bg-brand px-6 text-sm font-black text-brand-ink shadow-[0_20px_60px_-15px_color-mix(in_srgb,var(--color-brand)_60%,transparent)] transition hover:scale-[1.02] hover:brightness-110 md:h-14 md:px-8 md:text-base"
              >
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-white/25 [mask-image:linear-gradient(90deg,transparent,black_50%,transparent)] transition-transform duration-700 group-hover:translate-x-full" />
                Claim $10,000 demo
                <span aria-hidden className="text-lg">→</span>
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center rounded-full border border-rule bg-panel/70 px-6 text-sm font-semibold text-ink backdrop-blur hover:border-brand md:h-14 md:text-base"
              >
                Log in
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2">
              {[
                ["$1", "min trade"],
                ["95%", "payout"],
                ["400+", "assets"],
                ["24/7", "OTC"],
              ].map(([n, l]) => (
                <span
                  key={l}
                  className="inline-flex items-baseline gap-1.5 rounded-full border border-rule bg-panel/60 px-3 py-1.5 text-xs backdrop-blur"
                >
                  <b className="text-ink">{n}</b>
                  <span className="text-ink-2">{l}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Editorial hero image: desktop only. Hidden on phones so the hero stays light. */}
          <div className="relative hidden justify-self-center md:block md:justify-self-end">
            <div className="relative aspect-square w-[300px] overflow-hidden rounded-3xl border border-rule shadow-[0_40px_100px_-30px_color-mix(in_srgb,var(--color-brand)_30%,transparent),0_0_0_1px_color-mix(in_srgb,var(--color-brand)_18%,transparent)_inset] lg:w-[360px]">
              <Image
                src="/marketing/hero-editorial.jpg"
                alt="Trader in profile studying a live candlestick chart"
                fill
                sizes={editorialSizes}
                className="object-cover"
                loading="lazy"
              />
              {/* subtle top-down darkening so overlaid stickers stay legible */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ground/60 via-transparent to-transparent" />
            </div>
            <div className="absolute -left-14 top-10 z-10 -rotate-6 rounded-2xl border border-brand/40 bg-panel/90 px-4 py-3 text-[11px] shadow-2xl backdrop-blur">
              <p className="font-bold uppercase tracking-widest text-brand">Live now</p>
              <p className="mt-1 text-ink">6,204 traders</p>
              <p className="text-ink-3">on ASM right now</p>
            </div>
            <div className="absolute -right-10 -bottom-4 z-10 rotate-3 rounded-2xl border border-up/50 bg-panel/90 px-4 py-3 text-[11px] shadow-2xl backdrop-blur">
              <p className="font-bold uppercase tracking-widest text-up">Just settled</p>
              <p className="mt-1 text-ink">+$19.30 · AUD/NZD</p>
              <p className="text-ink-3">30s expiry · 93% payout</p>
            </div>
          </div>
        </div>
      </section>

      {/* LIVE BAND — signature motion: real streaming candles above the price marquee. */}
      <LiveCandleBand />
      <MarketingTicker speedSec={30} />

      {/* WHY */}
      <section className="relative border-b border-rule">
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(50%_60%_at_50%_0%,color-mix(in_srgb,var(--color-brand)_5%,transparent),transparent_60%)]" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-28">
          <Reveal>
            <div className="text-center">
              <p className="legend text-brand">Why traders switch to ASM</p>
              <h2 className="mx-auto mt-4 max-w-2xl text-[clamp(30px,7vw,64px)] font-black leading-[0.98] tracking-[-0.02em]">
                A trading UI that <span className="text-brand">actually feels</span> like the market.
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
                Forex. Crypto. Metals. Stocks. <span className="text-brand">OTC 24/7.</span>
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
                    {a.payoutPct}%
                  </span>
                </div>
                <div className="mt-6 flex items-baseline justify-between">
                  <p className="led text-xl">{a.price.toFixed(a.precision)}</p>
                  <p
                    className="text-xs font-bold"
                    style={{ color: a.changePct >= 0 ? "var(--color-up)" : "var(--color-down)" }}
                  >
                    {a.changePct >= 0 ? "+" : "−"}{Math.abs(a.changePct).toFixed(2)}%
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

      {/* PLATFORM */}
      <section id="platform" className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-28">
          <div className="grid gap-10 md:grid-cols-2 md:items-center md:gap-16">
            <div className="relative hidden md:block">
              <div className="pointer-events-none absolute -inset-10 rounded-full opacity-40 blur-3xl [background:radial-gradient(circle,color-mix(in_srgb,var(--color-brand)_25%,transparent),transparent_70%)]" />
              <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-rule shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
                <Image
                  src="/marketing/platform-editorial.jpg"
                  alt="Long-exposure of a live trading floor at night"
                  fill
                  sizes={editorialSizes}
                  className="object-cover"
                  loading="lazy"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-ground/70 via-transparent to-transparent" />
              </div>
            </div>
            <div>
              <p className="legend text-brand">The platform</p>
              <h2 className="mt-3 text-[clamp(30px,7vw,56px)] font-black leading-[0.98] tracking-[-0.02em]">
                Fast on a phone. <br />
                <span className="text-brand">Sharp on a desk.</span>
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-ink-2">
                Same UI, both surfaces. Thumb-sized controls on mobile with the Up/Down pinned above the nav; a full
                two-pane workspace on desktop.
              </p>
              <ul className="mt-8 space-y-4 text-sm">
                {[
                  ["Pinned action bar", "Up/Down never scrolls out of reach on phones."],
                  ["Real streaming prices", "Live from our engine, no delayed feed."],
                  ["Audited settlement", "Every open/close/settle tick recorded to a ledger."],
                ].map(([t, b]) => (
                  <li key={t} className="flex items-start gap-3 rounded-xl border border-rule bg-panel/60 p-4">
                    <span className="mt-1 grid h-6 w-6 flex-none place-items-center rounded-full bg-brand/20 text-brand">
                      ✓
                    </span>
                    <span>
                      <b className="text-ink">{t}.</b>{" "}
                      <span className="text-ink-2">{b}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

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
              Your first tick is <span className="text-brand">30 seconds away.</span>
            </h2>
          </Reveal>
          <p className="max-w-lg text-lg text-ink-2">
            $10,000 in demo funds. No card. Switch to live when you feel it.
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
    </div>
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

function BoldNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-ground/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-brand text-2xl font-black tracking-wide text-brand [text-shadow:0_0_20px_color-mix(in_srgb,var(--color-brand)_60%,transparent)]">
            ASM
          </span>
          <span className="text-sm font-semibold text-ink-2">Trade</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm text-ink-2 md:flex">
          <a href="#markets" className="hover:text-ink">Markets</a>
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#platform" className="hover:text-ink">Platform</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </div>
        <div className="flex items-center gap-2">
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

function BoldFooter() {
  return (
    <footer className="bg-ground">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <span className="font-brand text-2xl font-black tracking-wide text-brand">ASM</span>
            <p className="mt-4 max-w-xs text-xs leading-relaxed text-ink-3">
              UP or DOWN. Fixed risk. Real prices. Built for traders who like their platform to move as fast as they do.
            </p>
          </div>
          {[
            ["Product", ["Trade", "Markets", "Payouts", "Mobile"]],
            ["Company", ["About", "Careers", "Press", "Contact"]],
            ["Support", ["Help centre", "Deposit & withdrawal", "Compliance", "Risk disclosure"]],
          ].map(([h, links]) => (
            <div key={h as string}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-2">{h as string}</p>
              <ul className="mt-4 space-y-2 text-sm text-ink-2">
                {(links as string[]).map((l) => (
                  <li key={l}>
                    <a href="#" className="hover:text-ink">{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-rule pt-8 text-[11px] leading-relaxed text-ink-3">
          <p className="font-semibold uppercase tracking-widest text-ink-2">Risk disclosure</p>
          <p className="mt-2 max-w-3xl">
            Trading binary options carries substantial risk and can result in the loss of your invested capital. Past
            performance is not indicative of future results. ASM Trading is not available to residents of certain
            jurisdictions. Please review your local regulation before opening a live account.
          </p>
          <p className="mt-6">© {new Date().getFullYear()} ASM Trading. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
