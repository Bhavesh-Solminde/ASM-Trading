/**
 * Palette for the hosted checkout page. Kept out of GatewayIcon.tsx on
 * purpose: that file is "use client", and the checkout page is a Server
 * Component that calls checkoutTheme() while rendering. A function exported
 * from a client module reaches the server only as a client reference, so
 * calling it there throws and the whole checkout page 500s.
 */

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
