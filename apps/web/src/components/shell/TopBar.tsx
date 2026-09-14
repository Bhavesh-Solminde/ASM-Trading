import Link from "next/link";
import { PromoBanner } from "./PromoBanner";

/**
 * The platform top bar, rendered once by the (platform) layout above every
 * page. Static and server-rendered: per-account switching lives where it is
 * already interactive (the trade workspace's AccountSwitcher), so this bar
 * carries only navigation and the session action.
 */
export function TopBar() {
  return (
    <header className="flex items-center gap-4 border-b border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5">
      <Link href="/trade" className="flex items-baseline gap-2">
        <span className="text-sm font-bold tracking-tight">ASM TRADE</span>
        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)] sm:inline">
          Simulated
        </span>
      </Link>

      <div className="mx-auto hidden md:block">
        <PromoBanner />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/deposit"
          className="rounded-lg bg-[var(--color-up)] px-3 py-2 text-xs font-bold text-[#06231a]"
        >
          + Deposit
        </Link>
        <Link
          href="/withdrawal"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-xs font-bold"
        >
          Withdrawal
        </Link>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--color-ink-2)] hover:underline"
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
