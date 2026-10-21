# Brand assets

- `mark.webp`: the IXT tricolour mark (175x120), exported from the Passbook canvas. `source/mark.webp` is the original.
- `wordmark.webp`: the chrome "INDIAN X TRADE" wordmark, 750x190, transparent (RGBA with real alpha).
  Source: `apps/web/public/brand/indianxtrade-wordmark.png` (1179x298 RGBA), converted with
  `cwebp -q 90 -alpha_q 100 -resize 750 0 indianxtrade-wordmark.png -o wordmark.webp`.
  It replaced an opaque near-black export that left a visible box on the login, register and forgot screens.
  `Wordmark` in `src/ui/Brand.tsx` takes its aspect ratio from the file size, so update `WORDMARK` there when the file changes.
- `phonepe.jpg`, `gpay.png`, `paytm.png`, `upi.png`, `usdt.png`: the payment brand logos, copied unchanged from `apps/web/public/brand/`. They are drawn on a white tile (`IconTile`) and mapped by `src/ui/brand-logos.ts`.
