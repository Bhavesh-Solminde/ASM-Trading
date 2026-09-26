"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BOTTOM_NAV_ITEMS, isBottomNavItemActive } from "@/lib/nav";
import { Icon } from "./Icon";

export function BottomNavBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile navigation"
      className="col-start-1 row-start-4 hidden phone:flex land:hidden z-30 h-[var(--phone-nav-h,64px)] w-full items-stretch justify-around border-t border-rule bg-panel/95 pb-[max(4px,env(safe-area-inset-bottom))] backdrop-blur-md shadow-[0_-4px_16px_rgba(0,0,0,0.5)] select-none"
    >
      {BOTTOM_NAV_ITEMS.map((item) => {
        const active = isBottomNavItemActive(item, pathname);
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex flex-1 flex-col items-center justify-center gap-1 py-1 transition-all duration-150 active:scale-95 ${
              active ? "text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            {/* Active glowing indicator pill on top edge */}
            {active ? (
              <span className="absolute top-0 h-[2.5px] w-9 rounded-full bg-brand shadow-[0_0_10px_var(--color-brand)]" />
            ) : null}

            <Icon
              name={item.icon}
              className={`size-[22px] transition-colors duration-150 ${
                active ? "text-brand" : "text-ink-2 group-hover:text-ink"
              }`}
            />
            <span
              className={`text-[10px] tracking-wide transition-colors duration-150 ${
                active ? "font-bold text-ink" : "font-medium text-ink-2 group-hover:text-ink"
              }`}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
