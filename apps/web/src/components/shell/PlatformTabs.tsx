"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/withdrawal", label: "Withdrawal" },
  { href: "/balance", label: "Payments" },
  { href: "/trade", label: "Trades" },
  { href: "/account", label: "My account" },
] as const;

export function PlatformTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 overflow-x-auto rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded px-4 py-2 text-sm font-semibold ${
              active
                ? "bg-[var(--color-tile)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
