"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { syncRouteTheme, subscribe } from "@/lib/theme";

/** Keeps document chrome and cross-tab listening alive even on pages without a switch. */
export function ThemeRuntime() {
  const pathname = usePathname();
  useEffect(() => {
    syncRouteTheme();
    return subscribe(() => {});
  }, [pathname]);
  return null;
}
