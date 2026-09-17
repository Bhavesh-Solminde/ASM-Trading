import type { SVGProps } from "react";

// Inline stroke-icon set shared across the admin console. Kept as path data so
// icons inherit currentColor and theme without extra requests.
const PATHS: Record<string, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  users:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13A4 4 0 0116 11",
  coins:
    "M8 14a6 6 0 100-12 6 6 0 000 12M18.09 10.37A6 6 0 1110.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82",
  inbox:
    "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z",
  scroll: "M4 4a2 2 0 012-2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2zM8 8h6M8 12h8M8 16h5",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  trend: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  dollar: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18M12 7v5l3 2",
  ticket:
    "M3 9a3 3 0 000 6v2a2 2 0 002 2h14a2 2 0 002-2v-2a3 3 0 010-6V7a2 2 0 00-2-2H5a2 2 0 00-2 2zM13 5v14",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  arrowDown: "M12 5v14M19 12l-7 7-7-7",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  key: "M7.5 21a5.5 5.5 0 100-11 5.5 5.5 0 000 11M11.5 11.5L21 2M17 6l3 3M14 9l3 3",
  sun: "M12 16.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1",
  bell: "M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a2 2 0 003.4 0",
  lock: "M4 11h16v10H4zM8 11V7a4 4 0 018 0v4",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  ban: "M12 21a9 9 0 100-18 9 9 0 000 18M5.6 5.6l12.8 12.8",
  menu: "M3 6h18M3 12h18M3 18h18",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14M21 21l-4.3-4.3",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  message: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  external: "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3",
};

export type IconName = keyof typeof PATHS | string;

export function Icon({
  name,
  size = 18,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const d = PATHS[name] ?? PATHS.grid;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}
