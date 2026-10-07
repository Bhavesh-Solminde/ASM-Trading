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

const BRAND_EXTS = ["svg", "png", "jpg", "webp"] as const;

export function GatewayIcon({ method, className }: Props) {
  const cls = className ?? "h-10 w-10 flex-none rounded-xl";
  const slug = SLUG[method];
  const [brandUrl, setBrandUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    // Probe each supported extension in order; stop at the first one that
    // loads. SVG is preferred for crispness, PNG/JPG/WebP are accepted so a
    // raster asset works until an SVG is sourced.
    (async () => {
      for (const ext of BRAND_EXTS) {
        const url = `/brand/${slug}.${ext}`;
        const loaded = await new Promise<boolean>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
        if (cancelled) return;
        if (loaded) {
          setBrandUrl(url);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
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
