import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One frame for every signed-in content page (everything but /trade), so the
 * column width, gutters and the page heading sit in the same place as the
 * trader moves between sections. Before this each page picked its own
 * max-width and h1 size, so the Payments tab strip jumped sideways between
 * Deposits / Withdrawal / History and headings changed size page to page.
 *
 * Widths: `narrow` for single-column forms, `base` for account-style pages,
 * `wide` for pages with side-by-side panels or tables (all of Payments, so
 * its tab strip never moves).
 */
const WIDTH = {
  narrow: "max-w-xl",
  base: "max-w-3xl",
  wide: "max-w-4xl",
} as const;

type Props = {
  title: string;
  /** One line under the heading. */
  description?: ReactNode;
  /** Small back link above the heading, e.g. to /account. */
  back?: { href: string; label: string };
  /** Rendered above the heading (the Payments tab strip). */
  nav?: ReactNode;
  /** Right-aligned beside the heading (a page-level action). */
  actions?: ReactNode;
  width?: keyof typeof WIDTH;
  children: ReactNode;
};

export function PageFrame({ title, description, back, nav, actions, width = "base", children }: Props) {
  return (
    <main className={`mx-auto flex w-full ${WIDTH[width]} flex-col gap-6 px-6 pb-12 pt-8 phone:gap-5 phone:px-4 phone:pb-8 phone:pt-5`}>
      {nav}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1.5">
          {back ? (
            <Link
              href={back.href}
              className="mb-1 inline-flex w-fit items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink"
            >
              <span aria-hidden>&lsaquo;</span>
              {back.label}
            </Link>
          ) : null}
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-balance phone:text-xl">{title}</h1>
          {description ? <p className="max-w-[60ch] text-sm leading-relaxed text-ink-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}
