/** Heights under this (a 640dp phone, or a normal one with a large font) get the tighter lock screen. */
const SHORT_HEIGHT = 700;

/**
 * Logo width, vertical gap and top spacing for the lock screen, so the logo never reaches the status bar. A larger
 * system font scale makes the content taller, so it counts as less height (`windowHeight / fontScale`).
 */
export function lockLayout(windowHeight: number, fontScale: number): { logoWidth: number; gap: number; topPad: number } {
  const room = windowHeight / Math.max(fontScale, 1);
  return room < SHORT_HEIGHT ? { logoWidth: 52, gap: 12, topPad: 12 } : { logoWidth: 72, gap: 22, topPad: 0 };
}
