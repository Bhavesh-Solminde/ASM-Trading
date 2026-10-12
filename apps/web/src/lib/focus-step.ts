/**
 * Bring a step header into view and move focus to it.
 *
 * The platform pages scroll inside the shell's overflow container (not the
 * window), so `window.scrollTo` does nothing; `scrollIntoView` scrolls the
 * right ancestor. Focus is taken with `preventScroll` so the browser doesn't
 * fight the explicit scroll.
 */
export function focusStep(el: HTMLElement | null): void {
  if (!el) return;
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}
