"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Re-renders the server page on an interval so queue counts never go stale
 * while an operator keeps the tab open. Pauses while the tab is hidden and
 * refreshes as soon as it's visible again.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    setAt(new Date());
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setAt(new Date());
    };
    const id = window.setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);

  return (
    <span className="admin-live" title={`Refreshes every ${seconds} seconds`}>
      <i aria-hidden="true" />
      {at
        ? `Updated ${at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
        : "Live"}
    </span>
  );
}
