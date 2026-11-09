"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  browserStandalone,
  deviceKind,
  showIosInstallSheet,
  isPublicPath,
} from "@/lib/install-rules";
import {
  readFlag,
  readNumber,
  writeFlag,
  writeNumber,
} from "@/lib/safe-storage";
import { useScrollLock } from "@/lib/use-scroll-lock";
const SHOWN = "ixt.pwa.sheetShownAt",
  NEVER = "ixt.pwa.sheetNever";
function Guide({ close }: { close: () => void }) {
  useScrollLock();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-2xl border border-rule bg-panel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink backdrop:bg-black/60"
      aria-labelledby="ios-install-title"
    >
      <h2 id="ios-install-title" className="text-lg font-bold">
        Add IndianxTrade to your Home Screen
      </h2>
      <p className="mt-2 text-sm text-ink-2">
        Open full-screen and receive trade and payment alerts.
      </p>
      <ol className="mt-4 grid gap-4 text-sm">
        {[
          ["share", "Tap Share in Safari’s toolbar."],
          ["add", "Choose Add to Home Screen."],
          ["home", "Tap Add, then open IndianxTrade from your Home Screen."],
        ].map(([icon, text], i) => (
          <li key={icon} className="flex items-center gap-3">
            <img src={`/pwa/${icon}.svg`} width={40} height={40} alt="" />
            <span>
              <strong>{i + 1}.</strong> {text}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="h-12 rounded-xl bg-tile"
          onClick={() => {
            writeFlag(NEVER);
            close();
          }}
        >
          Don’t show again
        </button>
        <button
          autoFocus
          type="button"
          className="h-12 rounded-xl bg-brand-fill font-bold text-white"
          onClick={close}
        >
          Got it
        </button>
      </div>
    </dialog>
  );
}
export function IosInstallSheet() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (
      showIosInstallSheet({
        kind: deviceKind(navigator.userAgent),
        standalone: browserStandalone(),
        loggedIn: true,
        pathname,
        lastShownAt: readNumber(SHOWN),
        dismissedForever: readFlag(NEVER),
        now: Date.now(),
      })
    ) {
      writeNumber(SHOWN, Date.now());
      setOpen(true);
    }
  }, [pathname]);
  return open && !isPublicPath(pathname) ? (
    <Guide close={() => setOpen(false)} />
  ) : null;
}
