import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

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

/** Split-screen auth shell — editorial photo left, form right, brand top-left.
 *  Mobile: form-only, image hidden (matches the mobile-lean principle). */
export function AuthShell({ eyebrow, title, subtitle, children, footer, imageCaption }: Props) {
  return (
    <main className="relative min-h-dvh bg-ground text-ink">
      {/* Brand mark — links back to landing */}
      <Link
        href="/"
        className="absolute left-5 top-5 z-20 flex items-baseline gap-2 sm:left-8 sm:top-6"
      >
        <span className="font-brand text-2xl font-black tracking-wide text-brand [text-shadow:0_0_20px_color-mix(in_srgb,var(--color-brand)_50%,transparent)]">
          ASM
        </span>
        <span className="text-sm font-semibold text-ink-2">Trade</span>
      </Link>

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
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ground/95 via-ground/30 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-8 lg:p-12">
            <p className="legend text-brand">Live · AUD/NZD OTC · 93%</p>
            <p className="mt-3 max-w-md text-2xl font-black leading-tight tracking-tight text-ink">
              {imageCaption}
            </p>
          </div>
        </aside>

        {/* Form column */}
        <section className="relative flex items-center justify-center px-5 py-24 sm:px-8 md:py-12">
          <div className="w-full max-w-sm">
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
