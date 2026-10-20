export interface GradientPoints {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Start/end of a CSS `linear-gradient(<angle>deg, …)` across a w×h box (CSS: 0deg points up, 90deg right; the
 * gradient line passes through the centre and is |w·sin a| + |h·cos a| long), so Skia/SVG gradients match the canvas.
 */
export function cssGradientPoints(angleDeg: number, w: number, h: number): GradientPoints {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return {
    start: { x: w / 2 - dx * half, y: h / 2 - dy * half },
    end: { x: w / 2 + dx * half, y: h / 2 + dy * half },
  };
}
