import { MIN_TOUCH } from "@/ui/chip-metrics";

/** Gap between expiry chips, and the sheet's side padding. */
export const EXPIRY_CHIP_GAP = 8;
const SIDE_PADDING = 20;

/**
 * Width of one expiry chip so four fit a row at any screen width (a percentage width wrapped to three columns on 320dp
 * phones). The sheet is as wide as the screen.
 */
export function expiryChipWidth(screenWidth: number): number {
  const content = screenWidth - 2 * SIDE_PADDING;
  return Math.max(MIN_TOUCH, Math.floor((content - 3 * EXPIRY_CHIP_GAP) / 4));
}
