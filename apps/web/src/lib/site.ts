/* ---------------------------------------------------------------------------
 * Canonical site & entity facts — the single source of truth (NAP) for
 * metadata, JSON-LD, the sitemap, and the off-site profile checklist.
 *
 * Entity consistency is the mechanism behind a Google Knowledge Panel and
 * accurate AI answers, so the brand name, URL, logo and social handles must
 * have exactly ONE origin. Every off-site listing (Google Business, Wikidata,
 * Crunchbase, LinkedIn, X, Trustpilot) must match these values verbatim.
 * ------------------------------------------------------------------------- */

/** Absolute production origin. Overridable per-environment so canonicals and
 * OpenGraph URLs resolve correctly in preview/staging. No trailing slash. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://asmtrader.com"
).replace(/\/$/, "");

/** Canonical brand/entity name. Do NOT drift to "ASM Trading" / "ASM Trader". */
export const SITE_NAME = "ASM Trade";

/** One-line entity description reused across metadata and Organization JSON-LD. */
export const SITE_DESCRIPTION =
  "ASM Trade is a fast, mobile-first trading platform — trade forex, crypto, commodities and stocks from $1 with fixed risk and up to 95% payout. Free $10,000 demo, no card required.";

/** Short tagline for OG images and hero-style metadata. */
export const SITE_TAGLINE = "Trade every market. Feel the tick.";

/** Logo used by Organization/ImageObject schema and OG fallbacks. */
export const SITE_LOGO = `${SITE_URL}/brand/asm-logo.png`;

/** Approximate market focus, surfaced to LLMs and used for hreflang planning. */
export const SITE_LOCALES = ["en"] as const;

/**
 * `sameAs` graph — the off-site profiles that tie this entity together for the
 * Knowledge Graph. Fill each URL as the profile is claimed; empty entries are
 * omitted from schema automatically. Keep names/handles identical to SITE_NAME.
 */
export const SITE_SAME_AS: string[] = [
  // "https://www.linkedin.com/company/asmtrade",
  // "https://x.com/asmtrade",
  // "https://www.crunchbase.com/organization/asmtrade",
  // "https://www.trustpilot.com/review/asmtrader.com",
  // "https://www.wikidata.org/wiki/QXXXXXXX",
].filter(Boolean);

/** Support/contact point surfaced in Organization schema. */
export const SITE_CONTACT = {
  email: "support@asmtrader.com",
  contactType: "customer support",
} as const;

/** Build an absolute URL from a site-relative path. */
export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path: `/${path}`}`;
}
