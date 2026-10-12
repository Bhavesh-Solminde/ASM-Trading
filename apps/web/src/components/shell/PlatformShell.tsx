"use client";

import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { bonusPercentForDeposit } from "@/lib/bonus";
import { clockTime } from "@/lib/format-time";
import { useNowSec } from "@/lib/use-now";
import { usePlatform } from "./PlatformProvider";
import { IconRail } from "./IconRail";
import { PromoBanner } from "./PromoBanner";
import { Ticker } from "./Ticker";
import { TopBar } from "./TopBar";
import { BottomNavBar } from "./BottomNavBar";

/** Same blink conventions as TopBar's FEED_LABEL, with the short labels the phone status row has room for. */
const FEED_STATUS = {
  open: { text: "Live", dot: "bg-up shadow-[0_0_0_3px_rgba(59,229,132,.15)]" },
  connecting: { text: "Connecting", dot: "bg-brand blink" },
  closed: { text: "Reconnecting", dot: "bg-down blink" },
  unauthorised: { text: "Signed out", dot: "bg-down" },
} as const;

function StatusClock() {
  const now = useNowSec();
  return <span className="tabular-nums">{now === null ? "" : clockTime(now)}</span>;
}

/**
 * Phone /trade only: a slim 32px row in place of the 56px bonus banner. Feed
 * connection + clock on the left, the "+N% bonus" chip (opens the offer sheet)
 * on the right while a bonus tier is left.
 */
function TradeStatusRow() {
  const { status } = usePlatform();
  const feed = FEED_STATUS[status];
  return (
    <div className="flex h-full items-center gap-2 px-4 text-xs text-ink-2">
      <span aria-hidden className={`size-[7px] flex-none rounded-full ${feed.dot}`} />
      <span role="status">{feed.text}</span>
      <span aria-hidden className="text-ink-3">
        ·
      </span>
      <StatusClock />
      <div className="ml-auto">
        <PromoBanner variant="chip" />
      </div>
    </div>
  );
}

/**
 * The platform chrome grid. In focus mode (the phone fullscreen trading view)
 * the top bar, tape and rail collapse away so the chart and ticket own the
 * whole viewport; otherwise it renders the normal shell with top bar, ticker,
 * icon rail (desktop) or bottom navigation bar (phone). On phones the ticker
 * tape is dropped and its row holds the deposit-bonus banner instead — the row
 * collapses once the user has used every bonus tier. On /trade that row is the
 * slim status row instead (see TradeStatusRow).
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { focusMode, completedDeposits } = usePlatform();
  const promo = bonusPercentForDeposit(completedDeposits + 1) > 0;
  const pathname = usePathname();
  // The trade screen swaps the bonus banner for a slim status row (always shown, even once every bonus tier is used).
  const onTrade = pathname === "/trade" || pathname.startsWith("/trade/");

  if (focusMode) {
    return <div className="grid h-dvh min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden">{children}</div>;
  }

  return (
    <div
      style={{ "--phone-promo-h": onTrade ? "32px" : promo ? "56px" : "0px" } as CSSProperties}
      className="grid h-dvh min-h-[640px] grid-cols-[76px_minmax(0,1fr)] grid-rows-[60px_32px_minmax(0,1fr)] phone:min-h-0 phone:grid-cols-[minmax(0,1fr)] phone:grid-rows-[50px_var(--phone-promo-h)_minmax(0,1fr)_var(--phone-nav-h,38px)] [@media(height<30rem)]:grid-rows-[48px_0px_minmax(0,1fr)]"
    >
      <TopBar />
      <Ticker />
      <div className="col-start-1 row-start-2 hidden min-h-0 overflow-hidden phone:block [@media(height<30rem)]:hidden">
        {onTrade ? <TradeStatusRow /> : <PromoBanner variant="card" />}
      </div>
      <IconRail />
      <div className="col-start-2 row-start-3 min-h-0 min-w-0 overflow-auto overscroll-contain phone:col-start-1 phone:row-start-3">
        {children}
      </div>
      <BottomNavBar />
    </div>
  );
}
