/** Phones narrower than this (320dp and 360dp) get the tighter header. */
export const COMPACT_WIDTH = 380;

export function isCompactWidth(width: number): boolean {
  return width < COMPACT_WIDTH;
}

/**
 * Advance of one Martian Mono character in em, with the header's tracking and a margin for the Anek ₹.
 * Deliberately a little wide: a figure that fits by this estimate always fits on screen.
 */
const FIGURE_EM = 0.64;

/**
 * Font size at which `text` (a money figure, one line) fits `available` dp, never below `min`. Amounts must
 * show every digit, so the size is chosen up front instead of leaving it to the platform's auto-fit (which does
 * not reach nested runs on Android). Returns `base` while the room is unknown. `fontScale` is the system text scale.
 */
export function fitFigureSize({
  text,
  available,
  base,
  min,
  fontScale,
}: {
  text: string;
  available: number | null;
  base: number;
  min: number;
  fontScale: number;
}): number {
  if (available === null || available <= 0) return base;
  const chars = [...text].length;
  if (chars === 0) return base;
  const fits = available / (FIGURE_EM * chars * Math.max(fontScale, 1));
  return Math.floor(Math.max(min, Math.min(base, fits)) * 2) / 2;
}
