/** Approved R5 mobile palette. Original bull/bear gradient assets are retained. */
export const color = {
  ground: "#080a10",
  page: "#080a10",
  surface: "#131720",
  raised: "#1d2330",
  rule: "#303747",
  ruleSoft: "#222835",
  ink: "#f4f6fb",
  ink2: "#a4acbe",
  /** 5.02:1 on surface, 4.60:1 on raised. Never as text on the header (3.93:1 on headerTop). */
  ink3: "#858fa5",
  accent: "#456ae7",
  onAccent: "#ffffff",
  accentText: "#a2b8ff",
  accentDim: "#142247",
  up: "#2ecf7a",
  /** Text on `up` fills. */
  upInk: "#04170c",
  /** Down button fill, strokes and borders only. Red text on dark uses `downText`. */
  down: "#d63a30",
  /** Text on `down` fills. */
  downInk: "#ffffff",
  downText: "#ff827a",
  /** Bonus only. */
  gold: "#e4c58b",
  saffron: "#ff9933",
  tricolourWhite: "#f3f1ea",
  indiaGreen: "#1f9a12",
  dock: "#080a10",
  headerTop: "#16284f",
  headerBottom: "#0b1220",
  switchRule: "#2a3858",
  switchInk: "#9fb0d4",
  overlayPill: "#131720dd",
  scrim: "rgba(0, 0, 0, 0.62)",
  warnBg: "#2a1210",
} as const;

export const gradient = {
  header: { colors: ["#16284f", "#0b1220"] },
  up: { colors: ["#43e08f", "#2ecf7a", "#1fae63"], positions: [0, 0.45, 1], highlight: "rgba(255, 255, 255, 0.25)" },
  down: { colors: ["#ea5248", "#d63a30", "#b02a22"], positions: [0, 0.45, 1], highlight: "rgba(255, 255, 255, 0.2)" },
} as const;

export const radius = { xs: 3, sm: 8, md: 12, lg: 14, sheet: 22, pill: 999 } as const;
export const space = (n: number) => n * 4;
export const tokens = { color, gradient, radius, space };
