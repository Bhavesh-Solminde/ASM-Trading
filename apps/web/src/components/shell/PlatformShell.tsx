"use client";

import { usePlatform } from "./PlatformProvider";
import { IconRail } from "./IconRail";
import { Ticker } from "./Ticker";
import { TopBar } from "./TopBar";
import { BottomNavBar } from "./BottomNavBar";
import { PromoBanner } from "./PromoBanner";

/**
 * The platform chrome grid. In focus mode (the phone fullscreen trading view)
 * the top bar, tape and rail collapse away so the chart and ticket own the
 * whole viewport; otherwise it renders the normal shell with top bar, ticker,
 * icon rail (desktop) or bottom navigation bar (phone). On phones the ticker
 * tape is dropped and its row carries the slim deposit-bonus strip instead.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { focusMode } = usePlatform();

  if (focusMode) {
    return <div className="grid h-dvh min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden">{children}</div>;
  }

  return (
    <div className="grid h-dvh min-h-[640px] grid-cols-[76px_minmax(0,1fr)] grid-rows-[60px_32px_minmax(0,1fr)] phone:min-h-0 phone:grid-cols-[minmax(0,1fr)] phone:grid-rows-[28px_auto_minmax(0,1fr)_var(--phone-nav-h,32px)] [@media(height<30rem)]:grid-rows-[48px_0px_minmax(0,1fr)]">
      <TopBar />
      <Ticker />
      <div className="col-span-full row-start-2 hidden border-b border-rule bg-panel px-1.5 py-1 phone:block [@media(height<30rem)]:hidden">
        <PromoBanner compact />
      </div>
      <IconRail />
      <div className="col-start-2 row-start-3 min-h-0 min-w-0 overflow-auto overscroll-contain phone:col-start-1 phone:row-start-3">
        {children}
      </div>
      <BottomNavBar />
    </div>
  );
}
