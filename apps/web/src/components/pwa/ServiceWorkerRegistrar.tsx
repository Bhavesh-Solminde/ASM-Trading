"use client";
import { useEffect } from "react";
import { browserStandalone } from "@/lib/install-rules";
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator && browserStandalone())
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {});
  }, []);
  return null;
}
