"use client";

import { useEffect } from "react";

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
 * The ID comes from metaPixelId() in @/lib/meta-pixel, read server-side by the
 * page; with META_PIXEL_ID unset — local dev, tests — nothing loads.
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

function loadPixel(pixelId: string): Fbq {
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
  if (!initialised.has(pixelId)) {
    fbq("set", "autoConfig", false, pixelId);
    fbq("init", pixelId);
    initialised.add(pixelId);
  }
  return fbq;
}

export function MetaPixel({ pixelId }: { pixelId: string | null }) {
  useEffect(() => {
    if (!pixelId) return;
    loadPixel(pixelId)("track", "PageView");
  }, [pixelId]);

  if (!pixelId) return null;
  return (
    <noscript>
      <img
        height="1"
        width="1"
        style={{ display: "none" }}
        alt=""
        src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
      />
    </noscript>
  );
}
