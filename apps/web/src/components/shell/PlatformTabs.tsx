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
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-rule bg-panel p-1 [scrollbar-width:none] phone:grid phone:grid-cols-3">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            ref={active ? activeRef : undefined}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold phone:inline-flex phone:h-10 phone:items-center phone:justify-center phone:px-2 phone:py-0 phone:text-[13px] ${
              active
                ? "bg-tile text-ink shadow-[inset_0_0_0_1px_var(--color-tile-hi)]"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
