export interface SparklinePath {
  line: string;
  fill: string;
  lastX: number;
  lastY: number;
}

/** A decorative market-like line (no real data). Same seed, same shape. */
export function sparkline(seed: number, w: number, h: number, n: number): SparklinePath {
  if (n < 2) return { line: "", fill: "", lastX: 0, lastY: 0 };
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let p = 100;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    p = p + (rand() - 0.46) * 2.2 + Math.sin(i / 9 + seed) * 0.3;
    pts.push(p);
  }
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const step = w / (n - 1);
  const span = hi - lo || 1;
  const xy = pts.map((v, i) => [i * step, 8 + ((hi - v) / span) * (h - 40)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = xy[xy.length - 1] ?? [0, 0];
  return { line, fill: `${line} L${lastX.toFixed(1)} ${h} L0 ${h} Z`, lastX, lastY };
}
