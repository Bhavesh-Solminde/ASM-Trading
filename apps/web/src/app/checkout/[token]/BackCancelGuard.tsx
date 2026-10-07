"use client";

import { useEffect, useRef, useState } from "react";

/**
 * On the hosted checkout page, "back" is almost always an accident — a thumb
 * sweep, a reflex. The guard pushes a sentinel history entry on mount; when
 * the user navigates back it swallows the pop, re-pushes the sentinel, and
 * shows a confirm sheet. "Stay" keeps them on the page; "Cancel" releases
 * the guard and performs a real back navigation. Modeled after the
 * Amazon/Flipkart checkout prompt.
 */
export function BackCancelGuard({ brand }: { brand: string }) {
  const [open, setOpen] = useState(false);
  const releasedRef = useRef(false);

  useEffect(() => {
    // One sentinel is enough: every popstate we handle re-pushes it, so the
    // user cannot slip past by hammering back.
    window.history.pushState({ ixtGuard: true }, "");

    const onPop = () => {
      if (releasedRef.current) return;
      window.history.pushState({ ixtGuard: true }, "");
      setOpen(true);
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (releasedRef.current) return;
      e.preventDefault();
      // Older browsers display this; modern ones show a generic prompt.
      e.returnValue = "";
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-tx-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 phone:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-left shadow-2xl">
        <h2 id="cancel-tx-title" className="text-base font-bold text-[#1a1a1a]">
          Cancel this transaction?
        </h2>
        <p className="mt-2 text-sm text-[#5f6368]">
          If you leave now, your {brand} payment session will end. You&rsquo;ll
          need to start a new deposit to try again.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full rounded-lg bg-[#1a1a1a] px-4 py-3 text-sm font-bold text-white"
          >
            Stay on this page
          </button>
          <button
            type="button"
            onClick={() => {
              releasedRef.current = true;
              setOpen(false);
              // Two steps back: one for the sentinel we most recently
              // re-pushed, one for the actual previous page the user wanted.
              window.history.go(-2);
            }}
            className="w-full rounded-lg border border-[#dadce0] bg-white px-4 py-3 text-sm font-semibold text-[#5f6368]"
          >
            Cancel transaction
          </button>
        </div>
      </div>
    </div>
  );
}
