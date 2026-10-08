"use client";

import type { CSSProperties } from "react";
import { bonusPercentForDeposit } from "@/lib/bonus";
import { usePlatform } from "./PlatformProvider";
import { IconRail } from "./IconRail";
import { PromoBanner } from "./PromoBanner";
import { Ticker } from "./Ticker";
import { TopBar } from "./TopBar";
import { BottomNavBar } from "./BottomNavBar";

/**
 * The platform chrome grid. In focus mode (the phone fullscreen trading view)
 * the top bar, tape and rail collapse away so the chart and ticket own the
 * whole viewport; otherwise it renders the normal shell with top bar, ticker,
 * icon rail (desktop) or bottom navigation bar (phone). On phones the ticker
 * tape is dropped and its row holds the deposit-bonus banner instead — the row
 * collapses once the user has used every bonus tier.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { focusMode, completedDeposits } = usePlatform();
  const promo = bonusPercentForDeposit(completedDeposits + 1) > 0;

  if (focusMode) {
    return <div className="grid h-dvh min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden">{children}</div>;
  }

  return (
    <div
      style={{ "--phone-promo-h": promo ? "56px" : "0px" } as CSSProperties}
      className="grid h-dvh min-h-[640px] grid-cols-[76px_minmax(0,1fr)] grid-rows-[60px_32px_minmax(0,1fr)] phone:min-h-0 phone:grid-cols-[minmax(0,1fr)] phone:grid-rows-[50px_var(--phone-promo-h)_minmax(0,1fr)_var(--phone-nav-h,38px)] [@media(height<30rem)]:grid-rows-[48px_0px_minmax(0,1fr)]"
    >
      <TopBar />
      <Ticker />
      <div className="col-start-1 row-start-2 hidden min-h-0 overflow-hidden phone:block [@media(height<30rem)]:hidden">
        <PromoBanner variant="card" />
      </div>
      <IconRail />
      <div className="col-start-2 row-start-3 min-h-0 min-w-0 overflow-auto overscroll-contain phone:col-start-1 phone:row-start-3">
        {children}
      </div>
      <BottomNavBar />
    </div>
  );
}
