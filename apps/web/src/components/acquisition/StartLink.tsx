"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AD_ENTRY_KEY } from "@/lib/ad-landing";
import { trackPixelCustomEvent } from "@/components/seo/MetaPixel";

export function StartLink({ href, placement, className }: {
  href: string;
  placement: "header" | "hero" | "closing";
  className?: string;
}) {
  useEffect(() => {
    try { sessionStorage.setItem(AD_ENTRY_KEY, "/start"); } catch { /* Storage can be disabled in in-app browsers. */ }
  }, []);

  return (
    <Link href={href} prefetch={false} className={className} onClick={() => {
      trackPixelCustomEvent("GetStarted", { placement, source: "ad_landing" });
    }}>
      Get started <span aria-hidden="true">↗</span>
    </Link>
  );
}
