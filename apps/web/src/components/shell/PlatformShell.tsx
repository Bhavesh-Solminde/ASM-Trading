"use client";

import { usePlatform } from "./PlatformProvider";
import { IconRail } from "./IconRail";
import { Ticker } from "./Ticker";
import { TopBar } from "./TopBar";

/**
 * The platform chrome grid. In focus mode (the phone fullscreen trading view)
 * the top bar, tape and rail collapse away so the chart and ticket own the
 * whole viewport; otherwise it renders the normal three-row shell.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { focusMode } = usePlatform();

  if (focusMode) {
    return <div className="grid h-dvh min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden">{children}</div>;
  }

  return (
    <div className="grid h-dvh min-h-[640px] grid-cols-[76px_minmax(0,1fr)] grid-rows-[60px_32px_minmax(0,1fr)] phone:min-h-0 phone:grid-cols-[minmax(0,1fr)] phone:grid-rows-[56px_28px_minmax(0,1fr)] [@media(height<30rem)]:grid-rows-[48px_0px_minmax(0,1fr)]">
      <TopBar />
      <Ticker />
      <IconRail />
      <div className="col-start-2 row-start-3 min-h-0 min-w-0 overflow-auto overscroll-contain phone:col-start-1">
        {children}
      </div>
    </div>
  );
}
