import { headerMetrics, PILL_FONT, PILL_MIN_WIDTH, SWITCH_CHROME } from "@/ui/header-metrics";

/** Phones narrower than this (320dp and 360dp) get the tighter header. */
export const COMPACT_WIDTH = 380;

export function isCompactWidth(width: number): boolean {
  return width < COMPACT_WIDTH;
}

/*
 * Advance widths in em, read from the bundled font files (header-fit.test.ts parses the TTFs and fails when a
 * font swap makes any of these wrong). ASCII is Martian Mono, which is monospace; the rupee sign, the true minus
 * and Hindi words are Anek runs (see FigText), so they have their own, narrower or wider, advance.
 */
/** Martian Mono, every ASCII glyph, every weight (700 / 1000 units). */
export const MARTIAN_ADVANCE_EM = 0.7;
/** Anek ₹ and − (Latin and Devanagari, 400-600): the widest is 1033 / 2000 = 0.5165. */
export const RUPEE_ADVANCE_EM = 0.52;
/** The widest Anek Devanagari glyph of the Devanagari block (2105 / 2000 = 1.0525). Words are summed per code point. */
export const DEVANAGARI_ADVANCE_EM = 1.06;
/** Per character of a Demo / Live label (the widest real label is "Demo" at 2.51em for 4 characters). */
export const LABEL_ADVANCE_EM = 0.65;
/** Safety margin on every width estimate (rounding, hinting, subpixel positioning). */
export const FIT_MARGIN = 1.03;

/** The balance figure: base size, the smallest legible drawn size, tracking in em. */
export const FIGURE = { base: 16, floor: 11, tracking: -0.04 } as const;
/** The "+₹186.00 today" line above the balance. */
export const TODAY = { base: 10, floor: 8, tracking: -0.02 } as const;

/**
 * Style for the figures in the header's balance column. The platform measures a text's width itself and, on Android,
 * can come out a hair short of what it then draws, which showed as "आज +₹172.0…" with room to spare. A stretched,
 * right-aligned text takes the column's width instead, so the amount is never cut by its own measure.
 */
export const FILL_RIGHT = { alignSelf: "stretch", textAlign: "right" } as const;

/** Width of `text` in em at size 1, tracking included on every character (letterSpacing applies to each glyph). */
export function textEm(text: string, tracking: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const advance = code < 0x80 ? MARTIAN_ADVANCE_EM : code === 0x20b9 || code === 0x2212 ? RUPEE_ADVANCE_EM : DEVANAGARI_ADVANCE_EM;
    em += advance + tracking;
  }
  return em;
}

/**
 * The font size at which `text` (a money figure, one line) fits `room` dp, never above `base`, in whole or half
 * points rounded down. Amounts must show every digit, so the size is chosen up front instead of leaving it to the
 * platform's auto-fit (which does not reach nested runs on Android). `fontScale` is the system text scale: the drawn
 * size, and so the width, is size x fontScale. `fits` is false when the figure would be drawn smaller than `floor`
 * dp (a drawn size, so a large font scale does not make a legible figure look too small); the caller then changes
 * the layout instead of showing a tiny figure.
 */
export function fitSize({
  text,
  room,
  base,
  floor,
  tracking,
  fontScale,
}: {
  text: string;
  room: number;
  base: number;
  floor: number;
  tracking: number;
  fontScale: number;
}): { size: number; fits: boolean } {
  const em = textEm(text, tracking) * FIT_MARGIN * Math.max(fontScale, 0.5);
  const raw = em > 0 ? room / em : base;
  const size = Math.max(0.5, Math.floor(Math.min(base, raw) * 2) / 2);
  return { size, fits: size * fontScale >= floor };
}

/** Width of a Demo/Live pill: the label plus its padding, at least the 44pt target when it is a tap target. */
export function pillWidth(label: string, fontScale: number, pillPad: number, minWidth: number): number {
  const text = [...label].length * LABEL_ADVANCE_EM * FIT_MARGIN * PILL_FONT * fontScale;
  return Math.max(minWidth, text + 2 * pillPad);
}

export interface HeaderFit {
  /** The balance (and today line) sit in a second row under the header row, with the whole width. */
  stacked: boolean;
  figureSize: number;
  /** null when there is no today line. */
  todaySize: number | null;
}

/**
 * Decides, synchronously from the window width and font scale, how the header shows the balance: in the row
 * between the Demo/Live switch and the Deposit button, at a size that fits the room that row leaves, or, when the
 * figure (or the today line) would be drawn under its floor even so, in a second row with the full width.
 * `pillLabels` are the Demo/Live labels shown (one for the stale header); `hasDeposit` is false for the stale header.
 */
export function fitHeader({
  windowWidth,
  fontScale,
  pillLabels,
  hasDeposit,
  figure,
  today,
}: {
  windowWidth: number;
  fontScale: number;
  pillLabels: string[];
  hasDeposit: boolean;
  figure: string;
  today: string | null;
}): HeaderFit {
  const m = headerMetrics(isCompactWidth(windowWidth));
  const items = hasDeposit ? 4 : 3;
  const pills = pillLabels.reduce((sum, label) => sum + pillWidth(label, fontScale, m.pillPad, hasDeposit ? PILL_MIN_WIDTH : 0), 0);
  const rowRoom = windowWidth - 2 * m.padX - (items - 1) * m.gap - m.mark - (hasDeposit ? m.deposit : 0) - SWITCH_CHROME - pills - 1;

  const size = (room: number) => ({
    fig: fitSize({ text: figure, room, ...FIGURE, fontScale }),
    day: today === null ? null : fitSize({ text: today, room, ...TODAY, fontScale }),
  });
  const inRow = size(rowRoom);
  if (inRow.fig.fits && (inRow.day === null || inRow.day.fits)) {
    return { stacked: false, figureSize: inRow.fig.size, todaySize: inRow.day?.size ?? null };
  }
  const full = size(windowWidth - 2 * m.padX - 1);
  return { stacked: true, figureSize: full.fig.size, todaySize: full.day?.size ?? null };
}
