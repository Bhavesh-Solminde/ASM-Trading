"use client";

import { useEffect } from "react";
import { AD_ENTRY_KEY } from "@/lib/ad-landing";

/* ---------------------------------------------------------------------------
 * Meta (Facebook) Pixel — mounted only on the landing, login and register
 * pages, so Meta never sees signed-in pages (trade, deposit, KYC, withdrawal).
 *
 * The standard snippet is ported into an effect instead of an inline <script>
 * so the pixel is never in the HTML of any other page, and so it can be
 * locked down before init:
 *   - fbq.disablePushState: the pixel otherwise auto-fires PageView on every
 *     history.pushState, which would report /trade etc. after a login hop.
 *   - autoConfig off: no automatic button-click / form-field scraping on the
 *     login and signup forms.
 * fbevents.js sends at most one manual PageView per pixel per full page load,
 * so a client-side hop between these pages records no extra PageView — the
 * entry page (the ad click's landing) is what gets counted.
 *
 * The IDs come from metaPixelIds() in @/lib/meta-pixel, read server-side by
 * the page; with META_PIXEL_ID unset — local dev, tests — nothing loads. With
 * several IDs, each is init'ed and one fbq("track") reports to all of them.
 * ------------------------------------------------------------------------- */

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

const SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";
const initialised = new Set<string>();

function loadPixels(pixelIds: string[]): Fbq {
  if (!window.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as Fbq;
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.disablePushState = true;
    window.fbq = fbq;
    window._fbq ??= fbq;

    const script = document.createElement("script");
    script.async = true;
    script.src = SCRIPT_SRC;
    document.head.appendChild(script);
  }
  const fbq = window.fbq;
  for (const pixelId of pixelIds) {
    if (initialised.has(pixelId)) continue;
    fbq("set", "autoConfig", false, pixelId);
    fbq("init", pixelId);
    initialised.add(pixelId);
  }
  return fbq;
}

/**
 * Fire a standard event (e.g. CompleteRegistration) to every initialised
 * pixel. No-op when no pixel was mounted on this page load. If fbevents.js is
 * still loading the call is queued, and a client-side route change keeps the
 * queue alive until it flushes.
 */
export function trackPixelEvent(event: string) {
  window.fbq?.("track", event);
}

/** Custom funnel events contain only action context, never account details. */
export function trackPixelCustomEvent(event: string, parameters: Record<string, string> = {}) {
  window.fbq?.("trackCustom", event, parameters);
}

export function trackLogin(method: "email" | "google") {
  let source = "website";
  try {
    if (sessionStorage.getItem(AD_ENTRY_KEY) === "/start") source = "ad_landing";
  } catch { /* Tracking must never block authentication. */ }
  trackPixelCustomEvent("Login", { method, source });
}

export function MetaPixel({ pixelIds }: { pixelIds: string[] }) {
  // Stable dep: a fresh array from the server each render must not re-fire.
  const key = pixelIds.join(",");
  useEffect(() => {
    if (!key) return;
    loadPixels(key.split(","))("track", "PageView");
  }, [key]);

  if (pixelIds.length === 0) return null;
  return (
    <noscript>
      {pixelIds.map((id) => (
        <img
          key={id}
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`}
        />
      ))}
    </noscript>
  );
}
