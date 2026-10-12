import { useEffect } from "react";

/**
 * Lock page scrolling while a modal sheet is mounted.
 *
 * The platform pages scroll inside the shell's container (marked
 * `data-scroll-root` in PlatformShell), not the window, so `body { overflow:
 * hidden }` alone does nothing there. This locks that container, falling back
 * to `document.body` when the sheet is shown outside the shell, and restores
 * the previous inline value on cleanup.
 */
export function useScrollLock(): void {
  useEffect(() => {
    const target =
      document.querySelector<HTMLElement>("[data-scroll-root]") ?? document.body;
    const prev = target.style.overflow;
    target.style.overflow = "hidden";
    return () => {
      target.style.overflow = prev;
    };
  }, []);
}
