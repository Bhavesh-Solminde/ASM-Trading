/**
 * Compact brand marks for the deposit method picker and the hosted checkout
 * header. Each gateway renders as a square tile in its brand palette, so a user
 * scanning the list recognises PhonePe / Google Pay / Paytm / UPI without
 * reading the label. The marks are original stylised versions (brand-coloured
 * tiles with an initial or glyph), not reproductions of the official logos.
 */

type Props = { method: string; className?: string };

export function GatewayIcon({ method, className }: Props) {
  const cls = className ?? "h-9 w-9 flex-none rounded-lg";
  switch (method) {
    case "PhonePe":
      return (
        <svg viewBox="0 0 40 40" className={cls} aria-hidden="true">
          <rect width="40" height="40" rx="10" fill="#5F259F" />
          <text
            x="50%"
            y="54%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="18"
            fontWeight="800"
            fill="#ffffff"
          >
            ₹
          </text>
        </svg>
      );
    case "Gpay":
      return (
        <svg viewBox="0 0 40 40" className={cls} aria-hidden="true">
          <rect width="40" height="40" rx="10" fill="#ffffff" stroke="#dadce0" />
          <text
            x="50%"
            y="54%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="18"
            fontWeight="800"
            fill="#4285F4"
          >
            G
          </text>
          <circle cx="12" cy="30" r="2" fill="#EA4335" />
          <circle cx="20" cy="30" r="2" fill="#FBBC04" />
          <circle cx="28" cy="30" r="2" fill="#34A853" />
        </svg>
      );
    case "PayTM":
      return (
        <svg viewBox="0 0 40 40" className={cls} aria-hidden="true">
          <rect width="40" height="40" rx="10" fill="#ffffff" stroke="#dadce0" />
          <text
            x="20"
            y="22"
            textAnchor="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="11"
            fontWeight="800"
            fill="#002E6E"
          >
            pay
          </text>
          <text
            x="20"
            y="32"
            textAnchor="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="9"
            fontWeight="800"
            fill="#00BAF2"
          >
            tm
          </text>
        </svg>
      );
    case "UPI":
      return (
        <svg viewBox="0 0 40 40" className={cls} aria-hidden="true">
          <rect width="40" height="40" rx="10" fill="#ffffff" stroke="#dadce0" />
          <polygon points="20,8 30,20 20,32 10,20" fill="#FF7A00" />
          <polygon points="20,12 26,20 20,28" fill="#097939" />
        </svg>
      );
    case "USDT":
      return (
        <svg viewBox="0 0 40 40" className={cls} aria-hidden="true">
          <rect width="40" height="40" rx="10" fill="#26A17B" />
          <text
            x="50%"
            y="54%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            fontSize="18"
            fontWeight="800"
            fill="#ffffff"
          >
            ₮
          </text>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 40 40" className={cls} aria-hidden="true">
          <rect width="40" height="40" rx="10" fill="#2f81f7" />
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
 * Lightweight theme map for the hosted checkout page. Each entry is a brand
 * palette the provider-style page is tinted with, so the handoff looks like
 * the user's chosen app instead of one generic purple screen.
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
    primary: "#002E6E",
    primaryInk: "#ffffff",
    text: "#002E6E",
    muted: "#5a6880",
    softBg: "#e4f3fb",
    softBorder: "#b9ddf0",
    softInk: "#00BAF2",
    qrDark: "#002E6E",
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
    bg: "#f6f4fb",
    surface: "#ffffff",
    primary: "#5b2d9e",
    primaryInk: "#ffffff",
    text: "#241436",
    muted: "#6b5a8a",
    softBg: "#efeafa",
    softBorder: "#cbb9ea",
    softInk: "#5b2d9e",
    qrDark: "#241436",
  },
};

const USDT_FALLBACK: CheckoutTheme = CHECKOUT_THEMES.USDT!;

export function checkoutTheme(method: string): CheckoutTheme {
  return CHECKOUT_THEMES[method] ?? USDT_FALLBACK;
}
