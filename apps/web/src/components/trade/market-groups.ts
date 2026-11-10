/** Product picks use catalogue symbols; unavailable markets are never invented. */
export const POPULAR_SYMBOLS = ["BTCUSDT", "XAUUSD", "XAGUSD", "WTI", "BRENT"] as const;
export function isPopular(symbol: string): boolean { return (POPULAR_SYMBOLS as readonly string[]).includes(symbol); }
