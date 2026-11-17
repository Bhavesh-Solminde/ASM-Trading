/** Exceptions are whole files only where the file owns a fixed palette/identity.
 * Ordinary UI must use semantic tokens; do not add a file to silence a failure.
 */
export const colorAllowlist: Record<string, string> = {
  "app/checkout/[token]/UsdtClaimForm.tsx": "Approved theme-independent payment checkout design",
  "app/checkout/[token]/BackCancelGuard.tsx": "Approved theme-independent payment checkout design",
  "app/checkout/[token]/DepositResult.tsx": "Approved theme-independent payment checkout design",
  "app/checkout/[token]/ClaimForm.tsx": "Approved theme-independent payment checkout design",
  "app/checkout/[token]/page.tsx": "Approved theme-independent payment checkout design",
  "app/checkout/[token]/UpiStatusPoller.tsx": "Approved theme-independent payment checkout design",
  "app/checkout/[token]/UsdtStatusPoller.tsx": "Approved theme-independent payment checkout design",
  "app/checkout/[token]/claim/page.tsx": "Approved theme-independent payment checkout design",

  "app/globals.css": "Canonical dark/light tokens, document chrome and alpha-only masks",
  "app/theme-surfaces.css": "Canonical semantic surface/shadow tokens and fixed image treatments",
  "app/theme-chart.css": "Canonical chart palette tokens",
  "app/theme-special.css": "Special-page palette isolation and logo presentation",
  "app/(platform)/withdrawal/WithdrawForm.tsx": "Only the fixed exported certificate document and iframe stage retain black",
  "components/chart/chart-palette.ts": "Serializes resolved CSS token channels into canvas-compatible rgba; no literal palette",
  "app/layout.tsx": "Server browser chrome stays dark until blocking preference bootstrap",
  "app/manifest.ts": "Installed app splash colours are explicitly out of scope",
  "app/opengraph-image.tsx": "Fixed exported social image, explicitly out of scope",
  "lib/withdrawal-certificate.tsx": "Fixed exported certificate image, explicitly out of scope",
  "components/trade/AssetIcon.tsx": "National flags and asset/coin brand identities",
  "components/deposit/checkout-theme.ts": "Fixed payment-app brand palettes",
  "components/deposit/GatewayIcon.tsx": "Payment gateway brand marks and identity tiles",
  "components/auth/GoogleButton.tsx": "Official Google sign-in mark and button branding",
  "app/start/start.module.css": "Existing scoped light/dark acquisition palette and illustrative preview",
  "app/telegram/telegram.module.css": "Deliberately light-only Telegram landing palette",
  "components/festive/FirstVisitDiwali.module.css": "Intentionally dark cinematic fullscreen video overlay",
};
export function colorException(path: string): string | undefined {
  return path.startsWith("app/admin/") ? "Locked dark-only admin palette" : colorAllowlist[path];
}
// Includes SVG attributes, JS canvas values, inline styles, gradients, CSS functions,
// arbitrary Tailwind colours, and white/black utilities (including variants).
export const literalColor = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(|\b(?:bg|text|border|outline|ring|fill|stroke|from|via|to|shadow|divide|decoration|caret|accent)-(?:white|black)\b/gi;
