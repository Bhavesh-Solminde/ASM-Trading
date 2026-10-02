"use client";

import React, { memo } from "react";

// ============================================================================
// 1. HIGH-PERFORMANCE VECTOR ICONS (Currencies, Cryptos, Indices, Commodities)
// All SVGs are inline, zero-network, zero-decode lag, and retina-crisp.
// ============================================================================

export function FlagUSA({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <clipPath id="circle-us">
        <circle cx="16" cy="16" r="16" />
      </clipPath>
      <g clipPath="url(#circle-us)">
        {/* White base */}
        <rect width="32" height="32" fill="#ffffff" />
        {/* Red stripes (7 red stripes out of 13 total) */}
        <rect y="0" width="32" height="2.46" fill="#b22234" />
        <rect y="4.92" width="32" height="2.46" fill="#b22234" />
        <rect y="9.85" width="32" height="2.46" fill="#b22234" />
        <rect y="14.77" width="32" height="2.46" fill="#b22234" />
        <rect y="19.69" width="32" height="2.46" fill="#b22234" />
        <rect y="24.62" width="32" height="2.46" fill="#b22234" />
        <rect y="29.54" width="32" height="2.46" fill="#b22234" />
        {/* Navy Canton */}
        <rect width="14" height="17.2" fill="#1b2e61" />
        {/* Star Grid (Clean micro-dots for crisp display at 16-24px) */}
        <g fill="#ffffff">
          <circle cx="2.6" cy="2.8" r="0.75" />
          <circle cx="5.6" cy="2.8" r="0.75" />
          <circle cx="8.6" cy="2.8" r="0.75" />
          <circle cx="11.6" cy="2.8" r="0.75" />
          <circle cx="4.1" cy="5.4" r="0.75" />
          <circle cx="7.1" cy="5.4" r="0.75" />
          <circle cx="10.1" cy="5.4" r="0.75" />
          <circle cx="2.6" cy="8.0" r="0.75" />
          <circle cx="5.6" cy="8.0" r="0.75" />
          <circle cx="8.6" cy="8.0" r="0.75" />
          <circle cx="11.6" cy="8.0" r="0.75" />
          <circle cx="4.1" cy="10.6" r="0.75" />
          <circle cx="7.1" cy="10.6" r="0.75" />
          <circle cx="10.1" cy="10.6" r="0.75" />
          <circle cx="2.6" cy="13.2" r="0.75" />
          <circle cx="5.6" cy="13.2" r="0.75" />
          <circle cx="8.6" cy="13.2" r="0.75" />
          <circle cx="11.6" cy="13.2" r="0.75" />
        </g>
      </g>
    </svg>
  );
}

export function FlagEU({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#003399" />
      {/* 12 Gold Stars in circle */}
      <g fill="#ffcc00">
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const cx = 16 + 9.5 * Math.sin(rad);
          const cy = 16 - 9.5 * Math.cos(rad);
          return (
            <polygon
              key={i}
              points={`${cx},${cy - 1.4} ${cx + 0.4},${cy - 0.4} ${cx + 1.4},${cy - 0.4} ${cx + 0.6},${cy + 0.3} ${cx + 0.9},${cy + 1.3} ${cx},${cy + 0.7} ${cx - 0.9},${cy + 1.3} ${cx - 0.6},${cy + 0.3} ${cx - 1.4},${cy - 0.4} ${cx - 0.4},${cy - 0.4}`}
            />
          );
        })}
      </g>
    </svg>
  );
}

export function FlagUK({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <clipPath id="circle-uk">
        <circle cx="16" cy="16" r="16" />
      </clipPath>
      <g clipPath="url(#circle-uk)">
        {/* Navy base */}
        <rect width="32" height="32" fill="#012169" />
        {/* White diagonals */}
        <path d="M0,0 L32,32 M32,0 L0,32" stroke="#ffffff" strokeWidth="5.5" strokeLinecap="square" />
        {/* Red diagonals */}
        <path d="M0,0 L16,16 M32,0 L16,16 M32,32 L16,16 M0,32 L16,16" stroke="#c8102e" strokeWidth="2.2" strokeLinecap="square" />
        {/* White cross */}
        <path d="M16,0 V32 M0,16 H32" stroke="#ffffff" strokeWidth="9" />
        {/* Red cross */}
        <path d="M16,0 V32 M0,16 H32" stroke="#c8102e" strokeWidth="5.5" />
      </g>
    </svg>
  );
}

export function FlagJapan({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#f8fafc" />
      <circle cx="16" cy="16" r="8.2" fill="#bc002d" />
    </svg>
  );
}

export function FlagAustralia({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <clipPath id="circle-au">
        <circle cx="16" cy="16" r="16" />
      </clipPath>
      <g clipPath="url(#circle-au)">
        <rect width="32" height="32" fill="#00008b" />
        {/* Mini Canton UK */}
        <g transform="scale(0.48)">
          <rect width="32" height="32" fill="#012169" />
          <path d="M0,0 L32,32 M32,0 L0,32" stroke="#ffffff" strokeWidth="5" />
          <path d="M0,0 L32,32 M32,0 L0,32" stroke="#c8102e" strokeWidth="2.5" />
          <path d="M16,0 V32 M0,16 H32" stroke="#ffffff" strokeWidth="8" />
          <path d="M16,0 V32 M0,16 H32" stroke="#c8102e" strokeWidth="4.5" />
        </g>
        {/* Commonwealth 7-point star under canton */}
        <circle cx="8" cy="23" r="2.8" fill="#ffffff" />
        {/* Southern Cross constellation */}
        <circle cx="24" cy="7" r="1.3" fill="#ffffff" />
        <circle cx="21" cy="14" r="1.3" fill="#ffffff" />
        <circle cx="27" cy="16" r="1.3" fill="#ffffff" />
        <circle cx="23" cy="25" r="1.6" fill="#ffffff" />
        <circle cx="25.5" cy="20" r="0.9" fill="#ffffff" />
      </g>
    </svg>
  );
}

export function FlagCanada({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <clipPath id="circle-ca">
        <circle cx="16" cy="16" r="16" />
      </clipPath>
      <g clipPath="url(#circle-ca)">
        <rect width="32" height="32" fill="#ff0000" />
        <rect x="7" width="18" height="32" fill="#ffffff" />
        {/* Stylized Canadian Maple Leaf */}
        <path
          d="M16 8l1.3 3.4 2.8-.8-1.2 2.6 3.1 1.2-2.3 2.1 1.6 2.5-3.3.4.2 3.6-2.2-2.2v3.2h-1v-3.2l-2.2 2.2.2-3.6-3.3-.4 1.6-2.5-2.3-2.1 3.1-1.2-1.2-2.6 2.8.8L16 8z"
          fill="#ff0000"
        />
      </g>
    </svg>
  );
}

export function FlagSwitzerland({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#d52b1e" />
      {/* Swiss Cross */}
      <rect x="13.2" y="7.5" width="5.6" height="17" rx="0.8" fill="#ffffff" />
      <rect x="7.5" y="13.2" width="17" height="5.6" rx="0.8" fill="#ffffff" />
    </svg>
  );
}

export function FlagIndia({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <clipPath id="circle-in">
        <circle cx="16" cy="16" r="16" />
      </clipPath>
      <g clipPath="url(#circle-in)">
        {/* Saffron Top */}
        <rect width="32" height="10.67" fill="#ff9933" />
        {/* White Middle */}
        <rect y="10.67" width="32" height="10.67" fill="#ffffff" />
        {/* Green Bottom */}
        <rect y="21.34" width="32" height="10.67" fill="#128807" />
        {/* Ashoka Chakra */}
        <circle cx="16" cy="16" r="4.2" stroke="#000080" strokeWidth="0.8" fill="none" />
        <circle cx="16" cy="16" r="0.9" fill="#000080" />
        {/* 12 cross spokes (representing 24 spokes symmetrically) */}
        {[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165].map((deg) => (
          <line
            key={deg}
            x1={16 + 4.1 * Math.cos((deg * Math.PI) / 180)}
            y1={16 + 4.1 * Math.sin((deg * Math.PI) / 180)}
            x2={16 - 4.1 * Math.cos((deg * Math.PI) / 180)}
            y2={16 - 4.1 * Math.sin((deg * Math.PI) / 180)}
            stroke="#000080"
            strokeWidth="0.5"
          />
        ))}
      </g>
    </svg>
  );
}

export function IconBitcoin({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#f7931a" />
      <path
        d="M21.5 13.4c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.4-.3l.7-2.6-1.6-.4-.7 2.7c-.4-.1-.7-.2-1.1-.3l-2.3-.6-.5 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.2c0 0 .1 0 .2.1l-.2-.1-1.1 4.5c-.1.2-.3.6-.8.5 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5c.4.1.8.2 1.2.3l-.7 2.8 1.6.4.7-2.7c.4.1.9.2 1.4.3l-.7 2.7 1.7.4.7-2.7c2.9.5 5.1.3 6-2.3.7-2.1 0-3.3-1.5-4.1 1.1-.3 1.9-1.1 2.1-2.6zm-3.8 5.7c-.5 2.1-4 1-5.1.7l.9-3.7c1.1.3 4.8.8 4.2 3zm.5-5.8c-.5 1.9-3.4.9-4.3.7l.8-3.4c.9.2 3.9.7 3.5 2.7z"
        fill="#ffffff"
      />
    </svg>
  );
}

export function IconEthereum({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#1b1d24" />
      <g transform="translate(9, 6)">
        <polygon points="7,0 0.5,10.7 7,14.5 13.5,10.7" fill="#8c8c8c" />
        <polygon points="7,0 7,14.5 13.5,10.7" fill="#ffffff" />
        <polygon points="7,15.6 0.5,11.8 7,20.5 13.5,11.8" fill="#8c8c8c" />
        <polygon points="7,15.6 7,20.5 13.5,11.8" fill="#ffffff" />
        <polygon points="7,14.5 0.5,10.7 7,7.8" fill="#3c3c3b" />
        <polygon points="7,14.5 7,7.8 13.5,10.7" fill="#555555" />
      </g>
    </svg>
  );
}

export function IconSolana({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#000000" />
      <defs>
        <linearGradient id="sol-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9945ff" />
          <stop offset="100%" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <g fill="url(#sol-g)">
        <path d="M8.2 19.8l2.2-2.3h13.4l-2.2 2.3H8.2z" />
        <path d="M10.4 14.5l-2.2 2.3h13.4l2.2-2.3H10.4z" />
        <path d="M8.2 11.5l2.2-2.3h13.4l-2.2 2.3H8.2z" />
      </g>
    </svg>
  );
}

export function IconBNB({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#f3ba2f" />
      <g fill="#ffffff">
        <polygon points="16,8 19.5,11.5 21,10 16,5 11,10 12.5,11.5" />
        <polygon points="16,24 12.5,20.5 11,22 16,27 21,22 19.5,20.5" />
        <polygon points="8,16 11.5,12.5 10,11 5,16 10,21 11.5,19.5" />
        <polygon points="24,16 20.5,19.5 22,21 27,16 22,11 20.5,12.5" />
        <polygon points="16,11.5 20.5,16 16,20.5 11.5,16" />
      </g>
    </svg>
  );
}

export function IconDogecoin({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#c3a634" />
      <path
        d="M11 8.5h6.2c4.4 0 7.8 2.8 7.8 7.5s-3.4 7.5-7.8 7.5H11V8.5zm4 3v3.2h3.5v2.2H15v3.6h2.2c2.4 0 4.3-1.6 4.3-4.7 0-3.1-1.9-4.3-4.3-4.3H15z"
        fill="#ffffff"
      />
    </svg>
  );
}

export function IconXRP({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#23292f" />
      <path
        d="M23.5 8h2.3l-5.3 5.2c-2.4 2.4-6.4 2.4-8.8 0L6.4 8h2.3l4.1 4.1c1.8 1.8 4.6 1.8 6.4 0L23.5 8zm-15 16H6.2l5.3-5.2c2.4-2.4 6.4-2.4 8.8 0l5.3 5.2h-2.3l-4.1-4.1c-1.8-1.8-4.6-1.8-6.4 0L8.5 24z"
        fill="#ffffff"
      />
    </svg>
  );
}

export function IconTether({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="usdt-rim-clip">
          <circle cx="256" cy="256" r="256" />
        </clipPath>
      </defs>
      {/* Base Outer Ring (Light Teal) */}
      <circle cx="256" cy="256" r="256" fill="#53ae94" />
      {/* Upper-Right Lighter Rim Arc Highlight */}
      <path d="M -10,292 L 522,164 L 522,-10 L -10,-10 Z" fill="#8bcbb9" clipPath="url(#usdt-rim-clip)" />
      {/* Inner Core (Deep Emerald Teal) */}
      <circle cx="256" cy="256" r="208" fill="#26a17b" />
      {/* White Tether Symbol with 3D Ring Halo (Matching provided image) */}
      <path
        fill="#ffffff"
        fillRule="evenodd"
        d="M 156,144 L 354,144 L 354,197 L 281,197 L 281,223 L 320,227 L 359,236 L 377,245 L 383,252 L 383,260 L 374,269 L 349,279 L 313,286 L 281,288 L 281,306 L 281,381 L 229,381 L 229,289 L 192,285 L 163,279 L 138,269 L 130,262 L 128,257 L 130,250 L 136,244 L 150,237 L 180,229 L 229,223 L 228,197 L 156,197 Z M 218,229 L 176,234 L 151,241 L 143,247 L 142,252 L 145,256 L 152,260 L 185,268 L 225,272 L 287,272 L 322,268 L 351,263 L 367,256 L 370,252 L 370,248 L 365,243 L 359,240 L 341,235 L 317,231 L 281,229 L 281,260 L 241,261 L 229,260 L 229,230 Z"
      />
    </svg>
  );
}

export function IconGold({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Solid Gold Ochre Circle (Matching provided image #b68e46) */}
      <circle cx="256" cy="256" r="256" fill="#b68e46" />
      {/* 3 Pure White Gold Bullion Bars in Pyramid Stack */}
      <path
        fill="#ffffff"
        d="M 214,128 H 298 C 307,128 313,133 314,143 L 334,203 C 336,212 332,224 322,224 H 190 C 180,224 176,212 178,203 L 198,143 C 199,133 205,128 214,128 Z M 118,256 H 202 C 211,256 217,261 218,271 L 238,331 C 240,340 236,352 226,352 H 94 C 84,352 80,340 82,331 L 102,271 C 103,261 109,256 118,256 Z M 310,256 H 394 C 403,256 409,261 410,271 L 430,331 C 432,340 428,352 418,352 H 286 C 276,352 272,340 274,331 L 294,271 C 295,261 301,256 310,256 Z"
      />
    </svg>
  );
}

// ============================================================================
// 2. BADGE RESOLVER
// Maps symbols and display names to their base and quote icons cleanly.
// ============================================================================

interface AssetBadgeConfig {
  type: "pair" | "single" | "index";
  base: React.ComponentType<{ className?: string }>;
  quote?: React.ComponentType<{ className?: string }>;
  indexTag?: string;
}

export function resolveAssetBadges(identifier: string): AssetBadgeConfig {
  const normalized = identifier.toUpperCase().replace(/\s+/g, "").replace(/[\(\)]/g, "");

  // 1. Commodities
  if (normalized.includes("XAU") || normalized.includes("GOLD")) {
    return { type: "single", base: IconGold };
  }

  // 2. India Indices (Tricolor + custom micro-pill tag)
  if (normalized.includes("BANKNIFTY")) {
    return { type: "index", base: FlagIndia, indexTag: "BANK" };
  }
  if (normalized.includes("FINNIFTY")) {
    return { type: "index", base: FlagIndia, indexTag: "FIN" };
  }
  if (normalized.includes("NIFTYIT")) {
    return { type: "index", base: FlagIndia, indexTag: "IT" };
  }
  if (normalized.includes("MIDCAP")) {
    return { type: "index", base: FlagIndia, indexTag: "MID" };
  }
  if (normalized.includes("NIFTY50") || normalized.includes("NIFTY")) {
    return { type: "index", base: FlagIndia, indexTag: "N50" };
  }
  if (normalized.includes("SENSEX")) {
    return { type: "index", base: FlagIndia, indexTag: "BSE" };
  }

  // 3. Cryptos
  if (normalized.startsWith("BTC")) {
    return {
      type: "pair",
      base: IconBitcoin,
      quote: normalized.includes("USDT") ? IconTether : FlagUSA,
    };
  }
  if (normalized.startsWith("ETH")) {
    return {
      type: "pair",
      base: IconEthereum,
      quote: normalized.includes("USDT") ? IconTether : FlagUSA,
    };
  }
  if (normalized.startsWith("SOL")) {
    return {
      type: "pair",
      base: IconSolana,
      quote: normalized.includes("USDT") ? IconTether : FlagUSA,
    };
  }
  if (normalized.startsWith("BNB")) {
    return {
      type: "pair",
      base: IconBNB,
      quote: normalized.includes("USDT") ? IconTether : FlagUSA,
    };
  }
  if (normalized.startsWith("DOGE")) {
    return {
      type: "pair",
      base: IconDogecoin,
      quote: normalized.includes("USDT") ? IconTether : FlagUSA,
    };
  }
  if (normalized.startsWith("XRP")) {
    return {
      type: "pair",
      base: IconXRP,
      quote: normalized.includes("USDT") ? IconTether : FlagUSA,
    };
  }

  // 4. Forex Pairs
  if (normalized.startsWith("EUR")) {
    return { type: "pair", base: FlagEU, quote: FlagUSA };
  }
  if (normalized.startsWith("GBP")) {
    return { type: "pair", base: FlagUK, quote: FlagUSA };
  }
  if (normalized.startsWith("AUD")) {
    return { type: "pair", base: FlagAustralia, quote: FlagUSA };
  }
  if (normalized.startsWith("USD")) {
    if (normalized.includes("JPY")) return { type: "pair", base: FlagUSA, quote: FlagJapan };
    if (normalized.includes("CAD")) return { type: "pair", base: FlagUSA, quote: FlagCanada };
    if (normalized.includes("CHF")) return { type: "pair", base: FlagUSA, quote: FlagSwitzerland };
    return { type: "pair", base: FlagUSA, quote: FlagEU };
  }

  // Fallback
  return { type: "single", base: FlagUSA };
}

// ============================================================================
// 3. ASSET ICON COMPONENT (with Overlapping Dual-Circle Badge Layout)
// ============================================================================

export interface AssetIconProps {
  /** Symbol or Display Name (e.g., "AUD/USD", "BTCUSDT", "NIFTY 50 (India)") */
  symbol: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Optional container class */
  className?: string;
}

export const AssetIcon = memo(function AssetIcon({
  symbol,
  size = "md",
  className = "",
}: AssetIconProps) {
  const config = resolveAssetBadges(symbol);
  const BaseIcon = config.base;
  const QuoteIcon = config.quote;

  // Dimensional presets (Base, Quote, Overlap, Text)
  const dims = {
    sm: { base: "size-[18px]", quote: "size-[13px]", overlap: "-ml-[7px]", tag: "text-[7.5px] px-1 py-[0.5px]" },
    md: { base: "size-[22px]", quote: "size-[16px]", overlap: "-ml-[8px]", tag: "text-[8.5px] px-1.5 py-[0.5px]" },
    lg: { base: "size-[28px]", quote: "size-[20px]", overlap: "-ml-[10px]", tag: "text-[9.5px] px-2 py-[1px]" },
  }[size];

  if (config.type === "pair" && QuoteIcon) {
    return (
      <div className={`relative flex items-center flex-none select-none ${className}`}>
        {/* Primary / Base Asset Badge */}
        <div className={`relative z-10 shrink-0 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)] ${dims.base}`}>
          <BaseIcon className="size-full" />
        </div>
        {/* Secondary / Quote Asset Badge with Cut-Out Separator Ring */}
        <div
          className={`relative z-20 shrink-0 self-end rounded-full ring-[1.5px] ring-[#20242a] shadow-[0_1px_4px_rgba(0,0,0,0.5)] ${dims.overlap} ${dims.quote}`}
        >
          <QuoteIcon className="size-full" />
        </div>
      </div>
    );
  }

  if (config.type === "index") {
    return (
      <div className={`relative flex items-center flex-none select-none ${className}`}>
        {/* Tricolor National Base */}
        <div className={`relative z-10 shrink-0 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)] ${dims.base}`}>
          <BaseIcon className="size-full" />
        </div>
        {/* Compact Index Pill Tag */}
        {config.indexTag && (
          <div
            className={`relative z-20 shrink-0 rounded-[3px] bg-[#171b21] font-mono font-bold uppercase tracking-wider text-[#93c5fd] ring-[1.5px] ring-[#20242a] shadow-[0_1px_4px_rgba(0,0,0,0.5)] ${dims.overlap} ${dims.tag}`}
          >
            {config.indexTag}
          </div>
        )}
      </div>
    );
  }

  // Single Circle (Gold / Commodities)
  return (
    <div className={`relative flex items-center flex-none select-none ${className}`}>
      <div className={`relative shrink-0 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.4)] ${dims.base}`}>
        <BaseIcon className="size-full" />
      </div>
    </div>
  );
});
