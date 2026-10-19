/** Up/Down button height (canvas). */
export const BUTTON_H = 62;
/** Owner set the engraved art to 100% (overlay blend). */
export const BEAST_OPACITY = 1;
const BULL = { w: 380, h: 513, drawH: 88, rightGap: 5.8, top: -3 };
const BEAR = { w: 380, h: 510, drawW: 59, right: -1, top: -9.19 };

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bull "B3 bust": anchored to the button's right edge so narrow and wide phones all keep the head uncropped. x = 105 at the 176pt canvas width. */
export function bullFrame(buttonW: number): Frame {
  const w = (BULL.drawH * BULL.w) / BULL.h; // 65.2
  return { x: buttonW - BULL.rightGap - w, y: BULL.top, w, h: BULL.drawH };
}

/**
 * Bear "R1 swipe": the canvas box is 59×68 at right −1, bottom −5 with object-fit cover and object-position 49.58% 73.22%.
 * Cover scale = max(59/380, 68/510) = 0.15526, so the image draws 59 × 79.18 and overflows the box vertically by 11.18;
 * 73.22% of that (8.19) is cropped off the top. The 68pt box spans y = −1 … 67, so the image top is −1 − 8.19 = −9.19.
 * The caller clips to the button, so the box clip is redundant.
 */
export function bearFrame(buttonW: number): Frame {
  const w = BEAR.drawW; // 59
  const h = (BEAR.drawW * BEAR.h) / BEAR.w; // 79.18
  return { x: buttonW - BEAR.drawW - BEAR.right, y: BEAR.top, w, h }; // x = W − 58, y = −9.19
}
