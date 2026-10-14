/**
 * Mirrors the `@theme` block of apps/web/src/app/globals.css (the app is dark-only).
 * Names are the web custom properties in camelCase; tokens.test.ts keeps them in sync.
 */
export const color = {
  ground: "#000000",
  panel: "#0b0e13",
  tile: "#12161d",
  tileHi: "#1c222c",
  rule: "#232a34",
  ink: "#f4f7fb",
  ink2: "#98a2b3",
  ink3: "#7d8797",
  brand: "#2f81f7",
  brandInk: "#ffffff",
  brandFill: "#1f6feb",
  brandDim: "#10233f",
  up: "#3be584",
  /** Text on `up` fills; white on green fails contrast. */
  upInk: "#03170b",
  down: "#e5413b",
  /** Text on `down` fills. */
  downInk: "#fff4f3",
  caution: "#f5c518",
  warnBg: "#2a1210",
  /** Logo gold. Not a web CSS variable (the web theme dropped amber for blue). */
  gold: "#d4a72c",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const space = (n: number) => n * 4;
export const font = {
  regular: { fontSize: 14, color: color.ink },
  small: { fontSize: 12, color: color.ink2 },
  title: { fontSize: 18, fontWeight: "700" as const, color: color.ink },
  number: { fontVariant: ["tabular-nums" as const] },
};
export const tokens = { color, radius, space, font };
