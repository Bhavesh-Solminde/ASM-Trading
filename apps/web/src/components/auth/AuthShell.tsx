import { ThemeToggle } from "@/components/theme/ThemeToggle";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoWordmark } from "@/components/brand/Logo";

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
  /**
   * The fine print under the form. Defaults to the sign-in assurance, which
   * is what every auth page wants. Pass `null` on a page that is not a sign-in
   * — the maintenance screen, for one, where "by continuing you agree…" is
   * asking the reader to agree to something they cannot do.
   */
  legal?: ReactNode;
};

const DEFAULT_LEGAL = (
  <>
    Protected by session cookies, rate limits and audited login logs. By continuing you
    agree to the terms of service and risk disclosure.
  </>
);

/** The form surface follows the theme; the editorial photograph keeps its dark vignette. */

/** Split-screen auth shell — editorial photo left, form right, with a large
 *  brand lockup at the top of the form. Mobile: form-only, image hidden. */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  imageCaption,
  legal = DEFAULT_LEGAL,
}: Props) {
  return (
    <main className="relative min-h-dvh text-ink" style={{ background: "var(--color-auth-ground)" }}>
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
            style={{ background: "linear-gradient(to top, var(--color-auth-photo-ground) 4%, var(--color-auth-photo-fade) 45%, transparent)" }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-8 lg:p-12">
            <p className="legend text-photo-accent!">Live · NIFTY 50 · 93%</p>
            <p className="mt-3 max-w-md text-2xl font-black leading-tight tracking-tight text-photo-ink">
              {imageCaption}
            </p>
          </div>
        </aside>

        {/* Form column */}
        <section className="relative flex items-center justify-center px-5 py-16 sm:px-8 md:py-12">
          <div className="w-full max-w-sm">
            {legal !== null && <div className="absolute right-4 top-4"><ThemeToggle /></div>}
            {/* Large brand lockup */}
            <Link href="/" className="mb-10 flex flex-col items-start gap-3" aria-label="IndianxTrade — home">
              <LogoWordmark className="h-10 sm:h-11" />
              <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-ink-3">
                Trade · Invest · Grow
              </span>
            </Link>

            <p className="legend text-brand">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-black leading-[1.05] tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-3 text-sm text-ink-2">{subtitle}</p>

            <div className="mt-8">{children}</div>

            <p className="mt-8 text-sm text-ink-2">{footer}</p>

            {legal === null ? null : (
              <p className="mt-10 text-[11px] leading-relaxed text-ink-3">{legal}</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
