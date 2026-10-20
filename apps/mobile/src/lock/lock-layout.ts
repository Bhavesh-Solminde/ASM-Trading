/** Heights under this (a 640dp phone, or a large font on a normal one) get the tighter lock screen. */
const SHORT_HEIGHT = 700;

/** Logo width, vertical gap and top spacing for the lock screen, so the logo never reaches the status bar. */
export function lockLayout(windowHeight: number): { logoWidth: number; gap: number; topPad: number } {
  return windowHeight < SHORT_HEIGHT ? { logoWidth: 52, gap: 12, topPad: 12 } : { logoWidth: 72, gap: 22, topPad: 16 };
}
