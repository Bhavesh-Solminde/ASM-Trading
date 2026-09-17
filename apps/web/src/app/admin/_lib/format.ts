// Formatting + presentation helpers shared across admin pages.
// Money in this app is stored in minor units (cents / paise).

export function usdFromMinor(minor: number, dp = 2): string {
  return (
    "$" +
    (minor / 100).toLocaleString("en-US", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    })
  );
}

export function inrFromMinor(minor: number, dp = 2): string {
  return (
    "₹" +
    (minor / 100).toLocaleString("en-IN", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    })
  );
}

export function usdCompactFromMinor(minor: number): string {
  const n = minor / 100;
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

export function num(n: number): string {
  return Number(n).toLocaleString("en-US");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const AVATAR_COLORS = [
  "#8A6215",
  "#2C5A8A",
  "#157F52",
  "#6B4A9E",
  "#B0563A",
  "#0F7A78",
  "#9E4A6B",
  "#556228",
];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function timeAgo(date: Date | number): string {
  const ts = typeof date === "number" ? date : date.getTime();
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return Math.floor(d / 30) + "mo ago";
}

export function fmtDate(date: Date | number): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateTime(date: Date | number): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Build a URL query string, merging patch onto current params. Empty / null
 *  values drop the key. Used by sortable headers, pagers, and filters. */
export function hrefWith(
  path: string,
  current: Record<string, string | undefined>,
  patch: Record<string, string | number | undefined | null>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v != null && v !== "") params.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
