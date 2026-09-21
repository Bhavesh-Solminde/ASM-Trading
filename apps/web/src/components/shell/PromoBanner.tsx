import Link from "next/link";

export function PromoBanner() {
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
