# Payment-gateway brand assets

Drop the **official** SVG for each gateway in here and `<GatewayIcon>` will
use it on the deposit picker and the hosted checkout header. The file names
the component looks for:

| File              | Source (download the asset the brand publishes)                                   |
| ----------------- | --------------------------------------------------------------------------------- |
| `phonepe.svg`     | https://www.phonepe.com/brand/                                                    |
| `gpay.svg`        | https://developers.google.com/pay/api/web/guides/brand-guidelines                 |
| `paytm.svg`       | https://paytm.com/press/ (or paytm.com's media/press-kit page)                    |
| `upi.svg`         | https://www.npci.org.in/ — the UPI handbook/press section                         |
| `usdt.svg`        | https://tether.to/en/press                                                         |

Guidelines:

- Use the **square icon / app-tile** version of each mark, not the full
  wordmark — the row renders a 40 px tile. If only a horizontal lockup is
  available, use the mark-only variant from the same brand kit, or crop
  down to the icon.
- Keep the files small (≤ 10 KB each is realistic for a single-icon SVG).
- These are trademarks of the respective companies; the brand kits
  explicitly permit using them to show "we accept this payment method",
  which is this project's use. Don't restyle or recolor them, don't rotate,
  and don't combine them with anything that implies endorsement.
- Until an asset is dropped in, `GatewayIcon` renders an in-house stylised
  tile with the brand's known colour and an initial — no logo rendered.
