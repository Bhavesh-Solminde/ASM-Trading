"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { RAIL_ITEMS, isRailItemActive } from "@/lib/nav";
import { Icon } from "./Icon";

const ITEM =
  "relative grid w-[60px] justify-items-center gap-1.5 rounded pb-2 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.08em]";

export function IconRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Platform sections"
      className="col-start-1 row-start-3 flex flex-col items-center gap-1 border-r border-rule py-3 max-md:row-start-4 max-md:flex-row max-md:justify-around max-md:border-r-0 max-md:border-t max-md:px-2 max-md:py-1"
    >
      {RAIL_ITEMS.map((item) => {
        const gap = item.pinBottom ? <span className="flex-1 max-md:hidden" /> : null;
        const inner = (
          <>
            <Icon name={item.icon} className="size-[22px]" />
            {item.label}
            {!item.available && !item.pinBottom ? (
              <span className="-mt-1 text-[8px] tracking-[0.1em] text-ink-3">Soon</span>
            ) : null}
          </>
        );

        if (!item.available) {
          return (
            <Fragment key={item.id}>
              {gap}
              <span
                aria-disabled="true"
                title="Coming soon"
                className={`${ITEM} cursor-not-allowed text-ink-2 opacity-40 max-md:hidden`}
              >
                {inner}
              </span>
            </Fragment>
          );
        }

        const active = isRailItemActive(item, pathname);
        return (
          <Fragment key={item.id}>
            {gap}
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`${ITEM} ${
                active
                  ? "bg-tile text-ink before:absolute before:-left-2 before:bottom-3 before:top-3 before:w-[3px] before:rounded-r-sm before:bg-brand max-md:before:-top-[5px] max-md:before:bottom-auto max-md:before:left-3 max-md:before:right-3 max-md:before:h-[3px] max-md:before:w-auto"
                  : "text-ink-2 hover:bg-panel hover:text-ink"
              }`}
            >
              {inner}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
