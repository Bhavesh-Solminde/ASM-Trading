/**
 * The "Passbook" palette from the owner-approved design canvas (2026-10-14,
 * docs/design/passbook-canvas-2026-10-14). The app no longer mirrors the website's theme.
 *
 * Two values differ from the canvas so every text pair passes WCAG AA (owner to confirm in the PR):
 * `accent` is #3d6cf0 (canvas #3f6ff2; white on it is 4.56:1) and `ink3` is #7c8695 (canvas #737d8c).
 */
export const color = {
  ground: "#06080b",
  page: "#0a0d12",
  surface: "#0f141b",
  raised: "#171d26",
  rule: "#252d39",
  ruleSoft: "#1a212b",
  ink: "#edf1f6",
  ink2: "#a6b0be",
  /** 5.02:1 on surface, 4.60:1 on raised. Never as text on the header (3.93:1 on headerTop). */
  ink3: "#7c8695",
  accent: "#3d6cf0",
  onAccent: "#ffffff",
  accentText: "#86a6ff",
  accentDim: "#142247",
  up: "#2ecf7a",
  /** Text on `up` fills. */
  upInk: "#04170c",
  /** Down button fill, strokes and borders only. Red text on dark uses `downText`. */
  down: "#d63a30",
  /** Text on `down` fills. */
  downInk: "#ffffff",
  downText: "#ff7468",
  /** Bonus only. */
  gold: "#e2b54c",
  saffron: "#ff9933",
  tricolourWhite: "#f3f1ea",
  indiaGreen: "#1f9a12",
  dock: "#0b0f14",
  headerTop: "#16284f",
  headerBottom: "#0b1220",
  switchRule: "#2a3858",
  switchInk: "#9fb0d4",
  overlayPill: "#0f141bdd",
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
