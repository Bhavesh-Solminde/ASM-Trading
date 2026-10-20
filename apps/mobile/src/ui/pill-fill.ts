/** Corner radius for a fill drawn as an SVG rect: a pill radius (999) is capped at half the height. */
export function pillRadius(height: number, radius: number): number {
  return Math.max(0, Math.min(radius, height / 2));
}
