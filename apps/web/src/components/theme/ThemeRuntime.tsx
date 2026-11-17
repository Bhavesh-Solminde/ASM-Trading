"use client";
import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { syncRouteTheme, subscribe, watchThemeChrome } from "@/lib/theme";

/** Keeps document chrome and cross-tab listening alive even on pages without a switch. */
export function ThemeRuntime() {
  const pathname = usePathname();
  useLayoutEffect(() => { syncRouteTheme(); }, [pathname]);
  useLayoutEffect(() => {
    const stop = subscribe(() => {}), stopChrome = watchThemeChrome();
    return () => { stop(); stopChrome(); };
  }, []);
  return null;
}
