"use client";
import { useEffect } from "react";
import { browserStandalone } from "@/lib/install-rules";
import { syncExistingWebPush } from "@/lib/web-push-client";

/** Recheck every authenticated entry, including account changes after an expired cookie. */
export function ServiceWorkerRegistrar({ sessionKey }: { sessionKey: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !browserStandalone()) return;
    let stopped = false;
    let pending = false;
    async function sync() {
      if (stopped || pending) return;
      pending = true;
      try {
        // Updating the worker may wait on the network; it must not delay rebinding an existing endpoint.
        void navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .catch(() => {});
        if (!stopped) await syncExistingWebPush();
      } catch {
        /* unconfigured browsers stay usable */
      } finally {
        pending = false;
      }
    }
    const visible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    void sync();
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      window.removeEventListener("focus", visible);
      window.removeEventListener("pageshow", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [sessionKey]);
  return null;
}
