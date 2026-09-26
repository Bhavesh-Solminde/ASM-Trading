import type { SVGProps } from "react";

const PATHS = {
  trade: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 15v-4M12 15V8M16 15v-6" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
      <path d="M4 7l11-3v3" />
      <path d="M16 13.5h.5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8" />
      <path d="M12 16.5h.01" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  referral: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  cup: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4a3 3 0 0 0 3 3M17 6h3a3 3 0 0 1-3 3M12 14v3M8 20h8" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" />
    </>
  ),
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  caret: <path d="M7 10l5 5 5-5" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  arrow: <path d="M12 18V6M7 11l5-5 5 5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  expand: <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />,
  collapse: <path d="M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7" />,
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 2.6-6.3L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h13l-3.5-3.5" />
      <path d="M20 16H7l3.5 3.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 21 19H3z" />
      <path d="M12 10v4M12 16.5h.01" />
    </>
  ),
  sound: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10H4z" />
      <path d="M16.5 9a4 4 0 0 1 0 6" />
      <path d="M19 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  muted: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10H4z" />
      <path d="M15.5 10.5l5 5M20.5 10.5l-5 5" />
    </>
  ),
  candles: (
    <>
      <path d="M7 4v3m0 10v3" />
      <rect x="5" y="7" width="4" height="10" rx="0.5" fill="currentColor" fillOpacity="0.4" />
      <path d="M17 2v5m0 10v5" />
      <rect x="15" y="7" width="4" height="10" rx="0.5" fill="currentColor" fillOpacity="0.4" />
    </>
  ),
  hollow_candles: (
    <>
      <path d="M7 4v3m0 10v3" />
      <rect x="5" y="7" width="4" height="10" rx="0.5" fill="none" />
      <path d="M17 2v5m0 10v5" />
      <rect x="15" y="7" width="4" height="10" rx="0.5" fill="none" />
    </>
  ),
  volume_candles: (
    <>
      <path d="M7 3v3m0 12v3" />
      <rect x="4" y="6" width="6" height="12" rx="0.5" fill="currentColor" fillOpacity="0.4" />
      <path d="M17 5v3m0 8v3" />
      <rect x="16" y="8" width="2" height="8" rx="0.5" fill="currentColor" fillOpacity="0.4" />
    </>
  ),
  bars: (
    <>
      <path d="M7 3v18" />
      <path d="M4 14h3" />
      <path d="M7 8h3" />
      <path d="M17 3v18" />
      <path d="M14 9h3" />
      <path d="M17 16h3" />
    </>
  ),
  hlc_bars: (
    <>
      <path d="M7 3v18" />
      <path d="M7 8h3" />
      <path d="M17 3v18" />
      <path d="M17 16h3" />
    </>
  ),
  area: (
    <>
      <path d="M3 17l5-6 4 3 6-8 3 4" />
      <path d="M3 17l5-6 4 3 6-8 3 4v7H3z" fill="currentColor" fillOpacity="0.2" />
    </>
  ),
  hlc_area: (
    <>
      <path d="M3 10l5-4 5 3 8-5v11l-8 2-5-3-5 3z" fill="currentColor" fillOpacity="0.22" />
      <path d="M3 10l5-4 5 3 8-5" strokeOpacity="0.85" />
      <path d="M3 14l5-4 5 3 8-4" strokeWidth={1.75} />
      <path d="M3 18l5-3 5 2 8-3" strokeOpacity="0.85" />
    </>
  ),
  line: <path d="M3 16l6-7 4 5 8-9" />,
  line_markers: (
    <>
      <path d="M3 16l6-7 4 5 8-9" />
      <circle cx="3" cy="16" r="1.5" fill="currentColor" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" />
      <circle cx="13" cy="14" r="1.5" fill="currentColor" />
      <circle cx="21" cy="5" r="1.5" fill="currentColor" />
    </>
  ),
  step_line: <path d="M3 17h5v-6h5v-5h8" />,
  baseline: (
    <>
      <path d="M2 13h20" strokeDasharray="2 2" strokeOpacity="0.6" />
      <path d="M3 13l4-5 4 5 5 5 5-5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "size-[18px]",
  ...rest
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
