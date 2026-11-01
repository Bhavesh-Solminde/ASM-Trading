"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppConfigSchema } from "@asm/contracts";
import {
  appDownloadTarget,
  browserStandalone,
  deviceKind,
  showGetAppBar,
  isPublicPath,
} from "@/lib/install-rules";
import { readNumber, writeNumber } from "@/lib/safe-storage";
const DISMISSED = "ixt.app.barDismissedAt";
export function GetAppBar() {
  const pathname = usePathname();
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setHref(null);
    if (
      showGetAppBar({
        kind: deviceKind(navigator.userAgent),
        standalone: browserStandalone(),
        loggedIn: true,
        pathname,
        dismissedAt: readNumber(DISMISSED),
        now: Date.now(),
      })
    )
      void fetch("/api/v1/app/config", { signal: controller.signal })
        .then(async (r) => {
          if (!r.ok) throw Error();
          return AppConfigSchema.parse(await r.json());
        })
        .then((c) => {
          if (!controller.signal.aborted) setHref(appDownloadTarget(c));
        })
        .catch(() => {});
    return () => controller.abort();
  }, [pathname]);
  if (!href || isPublicPath(pathname)) return null;
  return (
    <aside
      className="col-start-1 row-start-4 hidden items-center gap-2 border-y border-rule bg-panel px-3 py-2 text-xs phone:flex land:hidden"
      aria-label="Android app"
    >
      <span className="flex-1">
        Get IndianxTrade — trade and payment alerts
      </span>
      <a
        href={href}
        className="rounded-lg bg-brand-fill px-3 py-2 font-bold text-white"
      >
        Get app
      </a>
      <button
        className="size-10"
        type="button"
        aria-label="Dismiss app download"
        onClick={() => {
          writeNumber(DISMISSED, Date.now());
          setHref(null);
        }}
      >
        ×
      </button>
    </aside>
  );
}
