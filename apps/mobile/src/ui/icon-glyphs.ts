export type IconName =
  | "trade" | "wallet" | "history" | "user" | "chevron" | "chevronDown" | "close" | "more" | "briefcase" | "star"
  | "search" | "lock" | "bolt" | "plus" | "arrowUp" | "arrowDown" | "fingerprint" | "key" | "eye" | "eyeOff"
  | "delete" | "download" | "expand" | "collapse";

export type Glyph = { paths: string[]; circles?: { cx: number; cy: number; r: number; fill?: boolean }[] };

/** 24×24 outline glyphs (lucide, as drawn on the Passbook canvas). Rects are written as paths. */
export const GLYPHS: Record<IconName, Glyph> = {
  expand: { paths: ["M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"] },
  collapse: { paths: ["M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3"] },
  trade: {
    paths: [
      "M9 5v4", "M8 9h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z", "M9 15v2", "M17 3v2",
      "M16 5h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M17 13v3", "M3 3v16a2 2 0 0 0 2 2h16",
    ],
  },
  wallet: {
    paths: [
      "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1",
      "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",
    ],
  },
  history: { paths: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"] },
  user: { paths: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"], circles: [{ cx: 12, cy: 7, r: 4 }] },
  chevron: { paths: ["m9 18 6-6-6-6"] },
  chevronDown: { paths: ["m6 9 6 6 6-6"] },
  close: { paths: ["M6 6l12 12M18 6L6 18"] },
  more: { paths: [], circles: [{ cx: 12, cy: 12, r: 1 }, { cx: 19, cy: 12, r: 1 }, { cx: 5, cy: 12, r: 1 }] },
  briefcase: { paths: ["M4 8h16v11H4z", "M9 8V5h6v3"] },
  star: { paths: ["M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2 8 13.7 4 9.8 9.5 9z"] },
  search: { paths: ["M15.5 15.5L20 20", "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z"] },
  lock: { paths: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 8 0v3"] },
  bolt: { paths: ["M13 3L5 14h6l-1 7 8-11h-6z"] },
  plus: { paths: ["M5 12h14", "M12 5v14"] },
  arrowUp: { paths: ["m5 12 7-7 7 7", "M12 19V5"] },
  arrowDown: { paths: ["M12 5v14", "m19 12-7 7-7-7"] },
  fingerprint: {
    paths: [
      "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4", "M14 13.12c0 2.38 0 6.38-1 8.88", "M17.29 21.02c.12-.6.43-2.3.5-3.02",
      "M2 12a10 10 0 0 1 18-6", "M2 16h.01", "M21.8 16c.2-2 .131-5.354 0-6", "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2",
      "M8.65 22c.21-.66.45-1.32.57-2", "M9 6.8a6 6 0 0 1 9 5.2v2",
    ],
  },
  key: {
    paths: [
      "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
    ],
    circles: [{ cx: 16.5, cy: 7.5, r: 0.5, fill: true }],
  },
  eye: {
    paths: ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  eyeOff: {
    paths: [
      "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      "M14.084 14.158a3 3 0 0 1-4.242-4.242",
      "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      "m2 2 20 20",
    ],
  },
  delete: {
    paths: [
      "M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z",
      "m12 9 6 6", "m18 9-6 6",
    ],
  },
  download: { paths: ["M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5"] },
};

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];
