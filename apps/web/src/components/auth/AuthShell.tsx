import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoEmblem } from "@/components/brand/Logo";

type Props = {
  /** Small eyebrow above the title, e.g. "Welcome back". */
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Copy under the form linking to the other side of auth. */
  footer: ReactNode;
  /** Overlay caption for the editorial image on desktop. */
  imageCaption: string;
};

/** Charcoal background for the auth pages — softer than the site's near-black. */
const AUTH_BG = "#14161b";

/** Split-screen auth shell — editorial photo left, form right, with a large
 *  brand lockup at the top of the form. Mobile: form-only, image hidden. */
export function AuthShell({ eyebrow, title, subtitle, children, footer, imageCaption }: Props) {
  return (
    <main className="relative min-h-dvh text-ink" style={{ background: AUTH_BG }}>
      <div className="grid min-h-dvh grid-cols-1 md:grid-cols-2">
        {/* Editorial image — desktop only */}
        <aside className="relative hidden overflow-hidden md:block">
          <Image
            src="/marketing/hero-editorial.jpg"
            alt=""
            fill
            sizes="(min-width: 768px) 50vw, 0px"
            className="object-cover"
            loading="lazy"
          />
          {/* Vignette to keep the caption readable */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: `linear-gradient(to top, ${AUTH_BG} 4%, ${AUTH_BG}4d 45%, transparent)` }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-8 lg:p-12">
            <p className="legend text-brand">Live · AUD/NZD OTC · 93%</p>
            <p className="mt-3 max-w-md text-2xl font-black leading-tight tracking-tight text-ink">
              {imageCaption}
            </p>
          </div>
        </aside>

        {/* Form column */}
        <section className="relative flex items-center justify-center px-5 py-16 sm:px-8 md:py-12">
          <div className="w-full max-w-sm">
            {/* Large brand lockup */}
            <Link href="/" className="mb-10 flex items-center gap-5" aria-label="ASM Trade — home">
              <LogoEmblem className="h-28 w-28 flex-none ring-1 ring-white/10 [filter:drop-shadow(0_0_30px_color-mix(in_srgb,var(--color-brand)_35%,transparent))]" />
              <span className="flex flex-col">
                <span className="flex items-baseline gap-2">
                  <span className="font-brand text-6xl font-black leading-none tracking-wide text-brand">ASM</span>
                  <span className="text-xl font-semibold text-ink-2">Trade</span>
                </span>
                <span className="mt-2.5 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.28em] text-ink-3">
                  Trade · Invest · Grow
                </span>
              </span>
            </Link>

            <p className="legend text-brand">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-black leading-[1.05] tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-3 text-sm text-ink-2">{subtitle}</p>

            <div className="mt-8">{children}</div>

            <p className="mt-8 text-sm text-ink-2">{footer}</p>

            <p className="mt-10 text-[11px] leading-relaxed text-ink-3">
              Protected by session cookies, rate limits and audited login logs. By continuing you
              agree to the terms of service and risk disclosure.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
