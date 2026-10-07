# Payment-gateway brand assets

Drop the official asset for each gateway in here and `<GatewayIcon>` will
use it on the deposit picker and the hosted checkout header. The component
probes `svg → png → jpg → webp` for each slug and uses the first one that
loads, so you can start with a raster version and upgrade to SVG later.

| Slug      | Source (download the asset the brand publishes)                              |
| --------- | ---------------------------------------------------------------------------- |
| `phonepe` | https://www.phonepe.com/brand/                                               |
| `gpay`    | https://developers.google.com/pay/api/web/guides/brand-guidelines            |
| `paytm`   | https://paytm.com/press/ (or paytm.com's media/press-kit page)               |
| `upi`     | https://www.npci.org.in/ — the UPI handbook/press section                    |
| `usdt`    | https://tether.to/en/press                                                   |

Guidelines:

- Use the **square icon / app-tile** version of each mark, not the full
  wordmark — the row renders a 40 px tile. If only a horizontal lockup is
  available, use the mark-only variant from the same brand kit, or crop
  down to the icon.
- SVG is strongly preferred: it stays crisp at every resolution and keeps
  the hosted-checkout header sharp on high-DPI phones. Raster (PNG/JPG/WebP)
  works as a stopgap but will look soft when scaled up.
- These are trademarks of the respective companies; the brand kits
  explicitly permit using them to show "we accept this payment method",
  which is this project's use. Don't restyle or recolor them, don't rotate,
  and don't combine them with anything that implies endorsement.
- Until an asset is dropped in, `GatewayIcon` renders an in-house stylised
  tile with the brand's known colour and a glyph — no logo rendered.
