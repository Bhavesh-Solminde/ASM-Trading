/**
 * Shared email chrome. Every template is a pure string function so this entry
 * stays client-safe (the in-app certificate renders in the browser). Styles are
 * inline and table-based because email clients strip flexbox and most <style>.
 *
 * Light is the default. A dark palette is layered on with
 * `@media (prefers-color-scheme: dark)` (Apple Mail, Outlook.com/macOS/iOS) and
 * Outlook's `[data-ogsc]/[data-ogsb]` hooks. Gmail ignores both and, on phones,
 * recolours the light version itself, so the light palette avoids pure #fff/#000.
 */

export const SUPPORT_EMAIL = "support@indianxtrade.com";

/** Light palette (inline defaults). */
const L = {
  page: "#f3f4f6",
  card: "#fffffe",
  rule: "#e5e7eb",
  panel: "#f8f9fb",
  ink: "#111827",
  ink2: "#4b5563",
  ink3: "#6b7280",
  link: "#1f6feb",
  button: "#1f6feb",
} as const;

/** Dark palette (applied by the media query / Outlook hooks). */
const D = {
  page: "#0b0d10",
  card: "#15181e",
  rule: "#262b33",
  panel: "#1b1f26",
  ink: "#f3f4f6",
  ink2: "#b4bcc8",
  ink3: "#8b95a3",
  link: "#58a6ff",
} as const;

export const EMAIL_PALETTE = { light: L, dark: D } as const;

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

/**
 * Images must load from a public host, so they always point at production even
 * when links (siteUrl) point at a local dev server.
 */
export const LOGO_URL = "https://indianxtrade.com/brand/indianxtrade-mark.png";

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url);

/** "Hi Asha," — or "Hi there," when we don't know a real name. */
export function greeting(name: string | null): string {
  const n = name?.trim();
  return p(n ? `Hi ${n},` : "Hi there,");
}

export function p(text: string): string {
  return `<p class="x-ink" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${L.ink};">${escapeHtml(text)}</p>`;
}

export function muted(text: string): string {
  return `<p class="x-ink2" style="margin:0 0 10px;font-size:13px;line-height:1.6;color:${L.ink2};">${escapeHtml(text)}</p>`;
}

/** A visible URL, for when the button is blocked or stripped. */
export function linkLine(url: string): string {
  if (!isHttpUrl(url)) return "";
  const safe = escapeHtml(url);
  return `<p style="margin:0 0 16px;font-size:12px;line-height:1.5;word-break:break-all;"><a class="x-link" href="${safe}" style="color:${L.link};">${safe}</a></p>`;
}

export function details(rows: EmailDetail[]): string {
  const tr = rows
    .map(
      (r, i) =>
        `<tr><td class="x-ink3${i ? " x-rule" : ""}" style="padding:11px 16px;font-size:13px;color:${L.ink3};${i ? `border-top:1px solid ${L.rule};` : ""}">${escapeHtml(r.label)}</td>` +
        `<td class="x-ink${i ? " x-rule" : ""}" style="padding:11px 16px;font-size:14px;font-weight:600;color:${L.ink};text-align:right;${i ? `border-top:1px solid ${L.rule};` : ""}">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" class="x-panel x-rule" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${L.panel};border:1px solid ${L.rule};border-radius:10px;border-collapse:separate;">${tr}</table>`;
}

function button(cta: { label: string; url: string }): string {
  // Only http(s): a template must never emit a javascript: or data: link.
  if (!isHttpUrl(cta.url)) return "";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr>` +
    `<td style="border-radius:8px;background:${L.button};">` +
    `<a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(cta.label)}</a>` +
    `</td></tr></table>`
  );
}

const DARK_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
@media (prefers-color-scheme: dark){
  .x-page{background:${D.page}!important;}
  .x-card{background:${D.card}!important;border-color:${D.rule}!important;}
  .x-panel{background:${D.panel}!important;}
  .x-rule{border-color:${D.rule}!important;}
  .x-ink{color:${D.ink}!important;}
  .x-ink2{color:${D.ink2}!important;}
  .x-ink3{color:${D.ink3}!important;}
  .x-link{color:${D.link}!important;}
  .x-amount{color:${D.link}!important;}
}
[data-ogsb] .x-page{background:${D.page}!important;}
[data-ogsb] .x-card{background:${D.card}!important;}
[data-ogsb] .x-panel{background:${D.panel}!important;}
[data-ogsc] .x-ink{color:${D.ink}!important;}
[data-ogsc] .x-ink2{color:${D.ink2}!important;}
[data-ogsc] .x-ink3{color:${D.ink3}!important;}
[data-ogsc] .x-link,[data-ogsc] .x-amount{color:${D.link}!important;}
`;

export function emailLayout(input: {
  /** Inbox preview line; hidden in the body. */
  preheader: string;
  heading: string;
  /** Already-safe HTML: build it from greeting()/p()/muted()/details()/certificateHtml(). */
  bodyHtml: string;
  cta?: { label: string; url: string };
  /** Already-safe HTML shown under the button. */
  afterCtaHtml?: string;
}): string {
  const { preheader, heading, bodyHtml, cta, afterCtaHtml } = input;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(heading)}</title><style>${DARK_CSS}</style></head>
<body class="x-page" style="margin:0;padding:0;background:${L.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" class="x-page" width="100%" cellpadding="0" cellspacing="0" style="background:${L.page};font-family:${font};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;background:#111318;border-radius:10px;padding:7px 8px;"><img src="${LOGO_URL}" width="44" height="30" alt="IndianxTrade" style="display:block;border:0;outline:none;"></td>
<td class="x-ink" style="vertical-align:middle;padding-left:12px;font-size:19px;font-weight:700;letter-spacing:-0.2px;color:${L.ink};">IndianxTrade</td>
</tr></table>
</td></tr>
<tr><td class="x-card" style="background:${L.card};border:1px solid ${L.rule};border-radius:12px;padding:32px 32px 12px;">
<h1 class="x-ink" style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;color:${L.ink};">${escapeHtml(heading)}</h1>
${bodyHtml}${cta ? button(cta) : ""}${afterCtaHtml ?? ""}
</td></tr>
<tr><td class="x-ink3" style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:${L.ink3};text-align:center;">
You're getting this email because you have an IndianxTrade account.<br>
Questions? Write to <a class="x-link" href="mailto:${SUPPORT_EMAIL}" style="color:${L.link};text-decoration:none;">${SUPPORT_EMAIL}</a>
</td></tr>
</table>
</td></tr></table></body></html>`;
}
