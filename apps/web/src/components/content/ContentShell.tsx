import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { SITE_NAME } from "@/lib/site";

/** Shared chrome for every public content page: a light header with the brand
 *  lockup and a sign-up CTA, and a footer with internal links (which also help
 *  crawlers discover the content surface). */
export function ContentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ground text-ink">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Logo />
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/guides" className="text-ink-2 hover:text-ink">
              Guides
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-brand px-4 py-1.5 font-semibold text-brand-ink"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 md:py-14">{children}</main>

      <footer className="border-t border-rule">
        <div className="mx-auto max-w-3xl px-5 py-8 text-sm text-ink-2">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/about" className="hover:text-ink">
              About
            </Link>
            <Link href="/legit" className="hover:text-ink">
              Is {SITE_NAME} legit?
            </Link>
            <Link href="/security" className="hover:text-ink">
              Security
            </Link>
            <Link href="/guides" className="hover:text-ink">
              Guides
            </Link>
            <Link href="/compare" className="hover:text-ink">
              Compare
            </Link>
          </div>
          <p className="mt-6 text-xs text-ink-3">
            {SITE_NAME} offers high-risk binary options trading. Most short-term
            traders lose money. Trade only with money you can afford to lose.
            Availability is restricted in some jurisdictions.
          </p>
        </div>
      </footer>
    </div>
  );
}
