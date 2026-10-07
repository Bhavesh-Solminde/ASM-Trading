"use client";

import { useEffect, useState } from "react";

/**
 * Compact tile for each gateway, shown on the deposit picker and the hosted
 * checkout header. The server render — and the client render until a probe
 * finishes — always shows the in-house stylised tile (a square in the
 * brand's known colour with a glyph or initial, not a reproduction of any
 * trademarked mark). On mount the component probes `/brand/{slug}.svg`
 * (populate from apps/web/public/brand/README.md's links); when the probe
 * loads cleanly, the tile swaps to the official asset. Starting with the
 * stylised tile and only upgrading on success avoids the broken-image
 * flicker a load-then-fallback approach causes when the file isn't there.
 */

type Props = { method: string; className?: string };

const SLUG: Record<string, string> = {
  PhonePe: "phonepe",
  Gpay: "gpay",
  PayTM: "paytm",
  UPI: "upi",
  USDT: "usdt",
};

export function GatewayIcon({ method, className }: Props) {
  const cls = className ?? "h-10 w-10 flex-none rounded-xl";
  const slug = SLUG[method];
  const [brandUrl, setBrandUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    const url = `/brand/${slug}.svg`;
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (!cancelled) setBrandUrl(url);
    };
    img.onerror = () => {
      /* keep the stylised fallback */
    };
    img.src = url;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [slug]);

  if (brandUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brandUrl}
        alt=""
        aria-hidden="true"
        className={`${cls} bg-white object-contain p-1`}
      />
    );
  }

  return <StylisedTile method={method} className={cls} />;
}

function StylisedTile({ method, className }: { method: string; className: string }) {
  switch (method) {
    case "PhonePe":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
          <rect width="48" height="48" rx="12" fill="#5F259F" />
          <text
            x="50%"
            y="54%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="24"
            fontWeight="800"
            fill="#ffffff"
          >
            ₹
          </text>
        </svg>
      );
    case "Gpay":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
          <rect width="48" height="48" rx="12" fill="#ffffff" stroke="#e4e7eb" />
          <text
            x="50%"
            y="56%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="22"
            fontWeight="800"
            fill="#1A73E8"
          >
            G
          </text>
          <g>
            <circle cx="14" cy="38" r="2" fill="#EA4335" />
            <circle cx="24" cy="38" r="2" fill="#FBBC04" />
            <circle cx="34" cy="38" r="2" fill="#34A853" />
          </g>
        </svg>
      );
    case "PayTM":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
          <rect width="48" height="48" rx="12" fill="#ffffff" stroke="#e4e7eb" />
          <text
            x="24"
            y="24"
            textAnchor="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="12"
            fontWeight="800"
            fill="#20336B"
          >
            pay
          </text>
          <text
            x="24"
            y="38"
            textAnchor="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="12"
            fontWeight="800"
            fill="#00BAF2"
          >
            tm
          </text>
        </svg>
      );
    case "UPI":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
          <rect width="48" height="48" rx="12" fill="#ffffff" stroke="#e4e7eb" />
          <polygon points="24,8 40,24 24,40 8,24" fill="#FF7A00" />
          <polygon points="24,14 34,24 24,34" fill="#097939" />
        </svg>
      );
    case "USDT":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
          <rect width="48" height="48" rx="12" fill="#26A17B" />
          <text
            x="50%"
            y="54%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="24"
            fontWeight="800"
            fill="#ffffff"
          >
            ₮
          </text>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
          <rect width="48" height="48" rx="12" fill="#2f81f7" />
        </svg>
      );
  }
}

export type CheckoutTheme = {
  bg: string;
  surface: string;
  primary: string;
  primaryInk: string;
  text: string;
  muted: string;
  softBg: string;
  softBorder: string;
  softInk: string;
  qrDark: string;
};

/**
 * Palette map for the hosted checkout page. Each entry is a brand-adjacent
 * colour set the page is tinted with so the handoff reads as the user's
 * chosen app instead of a single generic violet screen.
 */
export const CHECKOUT_THEMES: Record<string, CheckoutTheme> = {
  PhonePe: {
    bg: "#f3eef9",
    surface: "#ffffff",
    primary: "#5F259F",
    primaryInk: "#ffffff",
    text: "#2a1559",
    muted: "#75678f",
    softBg: "#f3eef9",
    softBorder: "#d8c7ea",
    softInk: "#5F259F",
    qrDark: "#2a1559",
  },
  Gpay: {
    bg: "#f1f6fe",
    surface: "#ffffff",
    primary: "#1A73E8",
    primaryInk: "#ffffff",
    text: "#202124",
    muted: "#5f6368",
    softBg: "#eaf2fe",
    softBorder: "#c8dcf9",
    softInk: "#1A73E8",
    qrDark: "#202124",
  },
  PayTM: {
    bg: "#eef5fb",
    surface: "#ffffff",
    primary: "#20336B",
    primaryInk: "#ffffff",
    text: "#20336B",
    muted: "#5a6880",
    softBg: "#e4f3fb",
    softBorder: "#b9ddf0",
    softInk: "#00BAF2",
    qrDark: "#20336B",
  },
  UPI: {
    bg: "#fff6ec",
    surface: "#ffffff",
    primary: "#097939",
    primaryInk: "#ffffff",
    text: "#1a1a1a",
    muted: "#5a5a5a",
    softBg: "#fff2e0",
    softBorder: "#f7cfa1",
    softInk: "#c25a00",
    qrDark: "#1a1a1a",
  },
  USDT: {
    bg: "#f0f8f5",
    surface: "#ffffff",
    primary: "#26A17B",
    primaryInk: "#ffffff",
    text: "#163e2f",
    muted: "#5a7a6c",
    softBg: "#e5f1ec",
    softBorder: "#b9dcce",
    softInk: "#1b7e5e",
    qrDark: "#163e2f",
  },
};

const USDT_FALLBACK: CheckoutTheme = CHECKOUT_THEMES.USDT!;

export function checkoutTheme(method: string): CheckoutTheme {
  return CHECKOUT_THEMES[method] ?? USDT_FALLBACK;
}
