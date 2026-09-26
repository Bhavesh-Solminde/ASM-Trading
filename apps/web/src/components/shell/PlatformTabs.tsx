"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/deposit", label: "Deposits" },
  { href: "/withdrawal", label: "Withdrawal" },
  { href: "/balance", label: "History" },
] as const;

export function PlatformTabs() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  // On narrow screens the strip scrolls; make sure the current tab is never the clipped one.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <div className="flex gap-1 overflow-x-auto rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-1 [scrollbar-width:none]">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            ref={active ? activeRef : undefined}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded px-4 py-2 text-sm font-semibold phone:px-3 phone:py-3 phone:text-[13px] ${
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
