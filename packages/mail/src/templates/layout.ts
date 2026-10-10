/**
 * Shared email chrome. Every template is a pure string function so this entry
 * stays client-safe (the in-app certificate renders in the browser). Styles are
 * inline and table-based because email clients strip <style> and flexbox.
 */

export const SUPPORT_EMAIL = "support@indianxtrade.com";

const C = {
  bg: "#000000",
  card: "#05070b",
  rule: "#232a34",
  ink: "#f4f7fb",
  ink2: "#98a2b3",
  ink3: "#5a6472",
  brand: "#2f81f7",
  gold: "#ffb000",
} as const;

export interface RenderedEmail {
  subject: string;
  html: string;
}

export interface EmailDetail {
  label: string;
  value: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Absolute link into the site. Same origin rule as apps/web/src/lib/site.ts. */
export function siteUrl(path = "/"): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://indianxtrade.com").replace(/\/$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url);

export function p(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.ink};">${escapeHtml(text)}</p>`;
}

export function muted(text: string): string {
  return `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:${C.ink2};">${escapeHtml(text)}</p>`;
}

/** A visible URL, for when the button is blocked or stripped. */
export function linkLine(url: string): string {
  if (!isHttpUrl(url)) return "";
  const safe = escapeHtml(url);
  return `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safe}" style="color:${C.brand};">${safe}</a></p>`;
}

export function details(rows: EmailDetail[]): string {
  const tr = rows
    .map(
      (r) =>
        `<tr><td style="padding:9px 0;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${C.ink2};">${escapeHtml(r.label)}</td>` +
        `<td style="padding:9px 0;font-size:14px;font-weight:700;color:${C.ink};text-align:right;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule};">${tr}</table>`;
}

function button(cta: { label: string; url: string }): string {
  // Only http(s): a template must never emit a javascript: or data: link.
  if (!isHttpUrl(cta.url)) return "";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr>` +
    `<td style="border-radius:999px;background:${C.brand};">` +
    `<a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:800;color:#ffffff;text-decoration:none;">${escapeHtml(cta.label)}</a>` +
    `</td></tr></table>`
  );
}

export function emailLayout(input: {
  /** Inbox preview line; hidden in the body. */
  preheader: string;
  heading: string;
  /** Already-safe HTML: build it from p()/muted()/details()/certificateHtml(). */
  bodyHtml: string;
  cta?: { label: string; url: string };
  /** Already-safe HTML shown under the button. */
  afterCtaHtml?: string;
}): string {
  const { preheader, heading, bodyHtml, cta, afterCtaHtml } = input;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.rule};border-radius:14px;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="height:4px;background:${C.brand};border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 30px 4px;">
<div style="font-size:13px;font-weight:800;letter-spacing:3px;color:${C.gold};">INDIANXTRADE</div>
<h1 style="margin:18px 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:#ffffff;">${escapeHtml(heading)}</h1>
</td></tr>
<tr><td style="padding:0 30px 22px;">${bodyHtml}${cta ? button(cta) : ""}${afterCtaHtml ?? ""}</td></tr>
<tr><td style="padding:16px 30px;background:#0b0e13;border-radius:0 0 14px 14px;font-size:11px;line-height:1.6;color:${C.ink3};">
You're getting this email because you have an IndianxTrade account. Questions? Write to
<a href="mailto:${SUPPORT_EMAIL}" style="color:${C.ink2};">${SUPPORT_EMAIL}</a>.
</td></tr>
</table></td></tr></table></body></html>`;
}
