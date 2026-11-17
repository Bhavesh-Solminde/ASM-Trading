# Intentional colours retained by the UI sweep

This is the sweep's inventory for the exported guard allowlist. Paths below are relative to
`apps/web/src`. All surrounding app surfaces, text, rings and shadows were converted to
semantic tokens. Chart, acquisition, brand artwork and special-page inventories are
maintained by their respective phases.

```ts
export const uiSweepKeptColors = {
  "app/theme-surfaces.css": "Semantic surface, elevation, festive illustration and fixed media-stage token definitions, with explicit values in both themes.",
  "components/trade/AssetIcon.tsx": "Only national-flag and asset/coin identity artwork retains literal fills/strokes. Separator rings, index tags and shadows use theme tokens.",
  "components/deposit/GatewayIcon.tsx": "Official payment-provider identity artwork, including white logo tiles; they intentionally retain the same colours in either theme.",
  "components/auth/GoogleButton.tsx": "Only Google's four official G artwork fills remain literal. Button surface, text, hover and border use tokens; light border follows Google's light-button branding.",
  "components/festive/FirstVisitDiwali.module.css": "Intentional full-screen cinematic video stage; fixed dark controls, scrim, caption and focus colours maintain contrast over the film in both themes.",
  "app/(platform)/withdrawal/WithdrawForm.tsx": "Only the exported standalone certificate document's black ground and its iframe stage stay fixed; certificate artwork is explicitly outside app theming.",
} as const;
```

The fixed identity artwork retains these literal colours:

- Google G: `#EA4335`, `#4285F4`, `#FBBC05`, `#34A853`.
- Payment marks/tiles: white; `#5F259F`, `#ffffff`, `#e4e7eb`, `#1A73E8`,
  `#EA4335`, `#FBBC04`, `#34A853`, `#20336B`, `#00BAF2`, `#FF7A00`, `#097939`,
  `#26A17B`, `#2f81f7`.
- Asset/flag artwork: `#ffffff`, `#b22234`, `#1b2e61`, `#003399`, `#ffcc00`,
  `#012169`, `#c8102e`, `#f8fafc`, `#bc002d`, `#00008b`, `#ff0000`, `#d52b1e`,
  `#ff9933`, `#128807`, `#000080`, `#f7931a`, `#1b1d24`, `#8c8c8c`, `#3c3c3b`,
  `#555555`, `#000000`, `#9945ff`, `#14f195`, `#f3ba2f`, `#c3a634`, `#23292f`,
  `#53ae94`, `#8bcbb9`, `#26a17b`, `#b68e46`.
- Cinematic introduction: `#29405a`, `#10243c`, `#f4f7fb`, `#0009`,
  `#080e16e8`, `#0b192bd9`, `#6ca9ff`, `#ffffff30`, `#0b192bcc`, `#203b58`,
  `#0b192baa`.
- Exported certificate stage: `#000` / black.

A few token roles intentionally have equal dark and light values: device hardware, CSS alpha
masks, camera overlays, photo captions/vignettes, button sheen, switch thumb and Google
artwork surfaces. These are defined in both theme blocks, rather than bypassing the token
system at their call sites. Seasonal in-page greetings, lamps and fireworks use distinct
light values; they are not an exception.
