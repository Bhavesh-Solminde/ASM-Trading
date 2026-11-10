# Chart comparison demo

Build the standalone HTML and start the browser preview from the repository root:

```sh
node demos/chart-comparison/build-demo.mjs
node demos/chart-comparison/serve-demo.mjs
```

Then open `http://127.0.0.1:4177/chart-comparison.html` in a browser. Keep the
preview process running while comparing. Codex's file viewer may block
external data and embeds, so use this browser URL instead of the file preview.
The sibling `../chart-comparison.html` is a single shareable HTML file with
the two open-source libraries, styling, and exchange adapter embedded.
All three charts require internet access for matching live market data.

This is an isolated browser demo. It does not import the app, connect to its
engine or database, change trading settings, or place any orders.

## What is being compared

- TradingView Lightweight Charts 5.2.1, matching the app's installed version.
  Its candles, wicks, price markers, volume bars, dotted grid, and crosshair
  use TradingView's standard palette (bullish `#089981`, bearish `#f23645`).
- KLineChart 9.8.12, with built-in MA/volume indicators and trend-line drawing.
- TradingView's public Advanced Chart **widget**. This is a UI preview, not
  the licensed Advanced Charts library. It cannot use custom OTC data or our
  SL/TP overlays. Approved library access is needed for that integration.

All three now show the **same Bitstamp market and timeframe**, starting with
BTC/USD at 1 minute. The other choices are ETH/USD and XRP/USD. The shared
market, timeframe, style, and theme controls update all three panels.

Lightweight Charts and KLineChart share the same OHLCV response from
Bitstamp's public API, initially 500 bars and then five-second updates. The
TradingView widget shows the corresponding BITSTAMP symbol through its own
connection. Its current candle may update at a slightly different time; this
is a comparison of the same exchange market, not one identical callback
stream across all three libraries. No synthetic candles are mixed into it.

Connecting our private OTC simulation to TradingView still requires approved
library access. The official hosted playground was tested directly and its
bundles reject the localhost origin via CORS; no proxy or access-control
bypass is used. The earlier illustrative order-book implementation remains
in `market-sim.js` for reference but is not loaded by the comparison page.

Market-data reference: [Bitstamp public API](https://www.bitstamp.net/api/).
Only public OHLC endpoints are used, without authentication or account calls.

## Trade preview

92% is represented as profit on the stake: ₹100 invested, ₹92 profit,
₹192 returned on a win. The fixed-expiry selector and sample SL/TP lines are
visual previews. There is no manual close or live settlement.

## Controls

Compare all three or focus one chart. Switch market, timeframe, chart style,
and light/dark theme. Pan and zoom normally. Toggle MA 20 and sample SL/TP
independently on the first two charts. KLineChart's Draw button adds a two-point
trend line; Clear removes user drawings. The refresh button reloads the
matching exchange candles and the TradingView widget. There is no pause
button because TradingView's public widget owns its real-time connection.

Source: `index.html`, `demo.css`, `live-feed.js`, `demo.js`.
Vendor license and TradingView attribution are retained in `vendor/` and the
self-contained HTML. No package installation is required.

Rebuild the single-file copy with `node demos/chart-comparison/build-demo.mjs`
from the repository root.
