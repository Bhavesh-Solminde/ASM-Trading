export const CENTER_PATH = "/affiliate/center";

export const affiliateCount = new Intl.NumberFormat("en-IN");

export const affiliateDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export const affiliateShortDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

export const affiliateMonthLabel = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export const LINK_KIND_LABELS = {
  HOME: "Home page",
  REGISTER: "Sign-up page",
  APP: "App download",
} as const;

export function depositBand(level: { minDeposits: number; maxDeposits: number | null }): string {
  return level.maxDeposits === null
    ? `${affiliateCount.format(level.minDeposits)}+`
    : `${affiliateCount.format(level.minDeposits)}–${affiliateCount.format(level.maxDeposits)}`;
}

export function centerUrl(path: string, values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return query.size ? `${path}?${query}` : path;
}
