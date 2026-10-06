import Link from "next/link";

/** Deposit-bonus link. `compact` is the slim pill the phone top bar shows beside the logo. */
export function PromoBanner({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Link
        href="/deposit"
        className="flex h-7 w-full min-w-0 items-center justify-center gap-1.5 rounded-[3px] border border-brand/35 bg-brand/10 px-1.5 text-[11px] text-ink-2 transition-colors hover:border-brand"
      >
        <span className="led led-lit flex-none text-[12px] text-brand">+100%</span>
        <span className="truncate font-semibold text-ink">Deposit bonus</span>
        <span aria-hidden className="flex-none font-bold text-brand">
          →
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/deposit"
      className="flex h-8 items-center gap-2.5 rounded border border-brand/35 bg-brand/5 px-3 text-xs text-ink-2 transition-colors hover:border-brand"
    >
      <span className="led led-lit text-[15px] text-brand">+100%</span>
      <span>
        <span className="font-semibold text-ink">Deposit bonus</span> on your first top-up
      </span>
    </Link>
  );
}
