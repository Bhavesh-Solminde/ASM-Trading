"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RAIL_ITEMS } from "@/lib/nav";

export function IconRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Platform sections"
      className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-edge)] bg-[var(--color-panel)] py-3"
    >
      {RAIL_ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);

        const inner = (
          <span className="relative flex flex-col items-center gap-1">
            <span aria-hidden className="text-lg leading-none">
              {item.icon}
            </span>
            <span className="text-[9px] font-semibold uppercase leading-tight tracking-[0.06em]">
              {item.label}
            </span>
            {item.badge ? (
              <span className="absolute -right-2 -top-1 rounded-full bg-[var(--color-brand)] px-1.5 text-[9px] font-bold text-white">
                {item.badge}
              </span>
            ) : null}
          </span>
        );

        if (!item.available) {
          return (
            <span
              key={item.id}
              title="Not available in this build"
              aria-disabled="true"
              className="w-[60px] cursor-not-allowed rounded-lg px-1 py-2.5 text-center text-[var(--color-ink-2)] opacity-40"
            >
              {inner}
            </span>
          );
        }

        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`w-[60px] rounded-lg px-1 py-2.5 text-center ${
              active
                ? "bg-[var(--color-brand)] text-white"
                : "text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]"
            }`}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
