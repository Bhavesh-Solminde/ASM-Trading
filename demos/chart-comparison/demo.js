"use strict";

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  // The file viewer is a different surface from a running web page. Keep a
  // direct route to the live preview visible there instead of a blank chart.
  const localPreview = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && /^https?:$/.test(location.protocol);
  $("#file-preview-notice").hidden = localPreview;
  const configs = window.AsmLiveFeed.configs;
  const state = { market: "btc", interval: 1, style: "candles", theme: "dark", view: "all", ma: { lightweight: true, kline: true }, levels: { lightweight: true, kline: true } };
  const markets = Object.fromEntries(Object.keys(configs).map(key => [key, new window.AsmLiveFeed.LiveMarket(key)]));
  const L = window.LightweightCharts;
  let lw, priceSeries, volumeSeries, maSeries, kl, levelLines = [], sampleEntry, tvTimer, tvGeneration = 0, toastTimer, klineViewNeedsReset = false;
  let dataGeneration = 0, polling = false, dataReady = false;
  const config = () => configs[state.market];
  const market = () => markets[state.market];
  const colors = () => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(["plot", "text", "muted", "up", "down", "grid", "rule", "accent", "panel"].map(key => [key, style.getPropertyValue(`--${key}`).trim()]));
  };
  const lightweightColors = () => ({
    ...colors(),
    // TradingView's standard candle palette, independent of the app chrome.
    up: "#089981", down: "#f23645",
    axis: state.theme === "dark" ? "#b2b5be" : "#787b86",
    crosshair: "#9598a1", crosshairLabel: state.theme === "dark" ? "#2a2e39" : "#787b86",
    volumeUp: "rgba(38, 166, 154, 0.5)", volumeDown: "rgba(239, 83, 80, 0.5)",
  });
  const bars = () => market().candles(state.interval);
  const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(value);
  const fmt = value => Number(value).toFixed(config().precision);
  const lwBar = bar => ({ time: bar.timestamp / 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  const priceBar = bar => state.style === "line" ? { time: bar.timestamp / 1000, value: bar.close } : lwBar(bar);
  const volumeBar = bar => ({ time: bar.timestamp / 1000, value: bar.volume, color: bar.close >= bar.open ? lightweightColors().volumeUp : lightweightColors().volumeDown });

  function notify(message) {
    $("#toast").textContent = message;
    $("#toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4500);
  }

  function movingAverage(data) {
    let sum = 0;
    return data.flatMap((bar, index) => {
      sum += bar.close;
      if (index >= 20) sum -= data[index - 20].close;
      return index >= 19 ? [{ time: bar.timestamp / 1000, value: sum / 20 }] : [];
    });
  }

  function ohlcText(bar) {
    return bar ? `O <b>${fmt(bar.open)}</b> &nbsp; H <b>${fmt(bar.high)}</b> &nbsp; L <b>${fmt(bar.low)}</b> &nbsp; C <b>${fmt(bar.close)}</b>` : "";
  }

  function lightweight() {
    const c = lightweightColors();
    lw = L.createChart($("#lightweight-chart"), {
      autoSize: true,
      layout: { background: { type: L.ColorType.Solid, color: c.plot }, textColor: c.axis, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 10, attributionLogo: true },
      grid: { vertLines: { color: c.grid, style: L.LineStyle.Dotted }, horzLines: { color: c.grid, style: L.LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.24 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, barSpacing: 7, rightOffset: 10 },
      crosshair: { mode: L.CrosshairMode.Normal, vertLine: { color: c.crosshair, labelBackgroundColor: c.crosshairLabel, style: L.LineStyle.Dashed }, horzLine: { color: c.crosshair, labelBackgroundColor: c.crosshairLabel, style: L.LineStyle.Dashed } },
      localization: { locale: "en-GB" },
    });
    volumeSeries = lw.addSeries(L.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    maSeries = lw.addSeries(L.LineSeries, { color: "#b7a0ef", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    setLwSeries();
    lw.subscribeCrosshairMove(param => {
      const data = param.seriesData.get(priceSeries);
      $("#lw-ohlc").innerHTML = ohlcText(data && "open" in data ? data : bars().at(-1));
    });
  }

  function setLwSeries() {
    if (priceSeries) lw.removeSeries(priceSeries);
    const c = lightweightColors();
    const opts = { priceFormat: { type: "price", precision: config().precision, minMove: config().tick }, priceLineWidth: 1, priceLineStyle: L.LineStyle.Dotted, upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down };
    if (state.style === "line") priceSeries = lw.addSeries(L.AreaSeries, { ...opts, lineColor: c.accent, topColor: c.accent + "25", bottomColor: c.accent + "00", lineWidth: 2 });
    else if (state.style === "bars") priceSeries = lw.addSeries(L.BarSeries, { ...opts, thinBars: true });
    else priceSeries = lw.addSeries(L.CandlestickSeries, { ...opts, borderVisible: true, ...(state.style === "hollow" ? { upColor: c.plot } : {}) });
    levelLines = [];
  }

  function kline() {
    kl = window.klinecharts.init("kline-chart");
    kl.setLocale("en-US");
    kl.setTimezone("UTC");
    kl.setBarSpace(7);
    kl.setOffsetRightDistance(70);
    kl.setPriceVolumePrecision(config().precision, 2);
    kl.createIndicator({ name: "MA", calcParams: [20] }, false, { id: "candle_pane" });
    kl.createIndicator("VOL", false, { id: "volume_pane", height: 85, minHeight: 50 });
    kl.subscribeAction("onDataReady", () => {
      if (!klineViewNeedsReset) return;
      klineViewNeedsReset = false;
      // Data and indicator calculations finish asynchronously. Fit the view
      // after they complete so the initial price range includes every bar.
      kl.setStyles({ yAxis: { type: "normal" } });
      kl.setBarSpace(7);
      kl.scrollToRealTime();
      kl.resize();
    });
    kl.subscribeAction("onCrosshairChange", event => {
      $("#kl-ohlc").innerHTML = ohlcText(event.kLineData || bars().at(-1));
    });
    // An annotation overlay stays at its exact price during pan and zoom.
    window.klinecharts.registerOverlay({
      name: "asmDemoLevel", totalStep: 1, needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates, bounding, overlay }) => {
        const y = coordinates[0]?.y;
        if (typeof y !== "number") return [];
        return [
          { type: "line", attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] }, styles: { color: overlay.extendData.color, size: 1, style: "dashed", dashedValue: [4, 4] }, ignoreEvent: true },
          { type: "text", attrs: { x: 10, y: y - 7, text: overlay.extendData.label, align: "left", baseline: "bottom" }, styles: { color: overlay.extendData.color, size: 10, backgroundColor: colors().plot, paddingLeft: 4, paddingRight: 4 }, ignoreEvent: true },
        ];
      },
    });
    applyKlineStyle();
  }

  function applyKlineStyle() {
    const c = colors();
    kl.setStyles(state.theme);
    kl.setStyles({
      grid: { horizontal: { color: c.grid, style: "solid" }, vertical: { color: c.grid, style: "solid" } },
      candle: {
        type: ({ candles: "candle_solid", hollow: "candle_up_stroke", bars: "ohlc", line: "area" })[state.style],
        bar: { upColor: c.up, downColor: c.down, noChangeColor: c.muted, upBorderColor: c.up, downBorderColor: c.down, noChangeBorderColor: c.muted, upWickColor: c.up, downWickColor: c.down, noChangeWickColor: c.muted },
        area: { lineSize: 2, lineColor: c.accent, backgroundColor: [{ offset: 0, color: c.accent + "25" }, { offset: 1, color: c.accent + "00" }] },
        tooltip: { showRule: "none" },
        priceMark: { high: { show: false }, low: { show: false }, last: { upColor: c.up, downColor: c.down, noChangeColor: c.muted } },
      },
      indicator: { lines: [{ color: "#b7a0ef", size: 1 }], tooltip: { showRule: "none" }, bars: [{ upColor: c.up + "65", downColor: c.down + "65", noChangeColor: c.muted + "65" }] },
      xAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: { color: c.muted, size: 10 } },
      yAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: { color: c.muted, size: 10 } },
      separator: { color: c.rule, size: 1 },
      crosshair: { horizontal: { line: { color: c.muted }, text: { backgroundColor: c.rule } }, vertical: { line: { color: c.muted }, text: { backgroundColor: c.rule } } },
    });
  }

  function addLevels() {
    const c = colors();
    const gap = Math.max(config().tick * 12, sampleEntry * 0.0008);
    const levels = [{ price: sampleEntry, label: "Buy entry", color: c.accent }, { price: sampleEntry + gap, label: "TP", color: c.up }, { price: sampleEntry - gap, label: "SL", color: c.down }];
    levelLines.forEach(line => priceSeries.removePriceLine(line));
    levelLines = [];
    kl.removeOverlay({ groupId: "trade-levels" });
    for (const level of levels) {
      const lwLevelColor = level.label === "TP" ? lightweightColors().up : level.label === "SL" ? lightweightColors().down : level.color;
      if (state.levels.lightweight) levelLines.push(priceSeries.createPriceLine({ price: level.price, color: lwLevelColor, lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: true, title: level.label }));
      if (state.levels.kline) kl.createOverlay({ name: "asmDemoLevel", groupId: "trade-levels", lock: true, points: [{ timestamp: bars().at(-1).timestamp, value: level.price }], extendData: { color: level.color, label: `${level.label}  ${fmt(level.price)}` } });
    }
  }

  function updateStats() {
    const last = bars().at(-1);
    if (!last) return;
    $$('[data-price]').forEach(el => { el.textContent = fmt(last.close); });
    $('[data-chart="lightweight"] [data-price]').style.color = last.close >= last.open ? lightweightColors().up : lightweightColors().down;
    $("#lw-ohlc").innerHTML = ohlcText(last);
    $("#kl-ohlc").innerHTML = ohlcText(last);
    $("#feed-status").textContent = `${config().name} · Bitstamp · ${state.interval === 60 ? "1h" : `${state.interval}m`} · last candle ${new Date(last.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
  }

  async function loadMarketData() {
    const generation = ++dataGeneration;
    const selectedMarket = state.market;
    const selectedInterval = state.interval;
    dataReady = false;
    $("#feed-status").textContent = `Loading ${config().name} from Bitstamp…`;
    $("#stream-label").textContent = "Loading market data";
    $$('[data-price]').forEach(el => { el.textContent = "—"; });
    priceSeries.setData([]);
    volumeSeries.setData([]);
    maSeries.setData([]);
    kl.clearData();
    try {
      await markets[selectedMarket].refresh(selectedInterval, true);
      if (generation !== dataGeneration) return;
      fillCharts();
      dataReady = true;
      $("#stream-label").textContent = "Live Bitstamp feed";
    } catch (error) {
      if (generation !== dataGeneration) return;
      $("#feed-status").textContent = `Could not load the matching exchange candles. ${error.message} Use Refresh to retry.`;
      $("#stream-label").textContent = "Retry market data";
      console.warn("Exchange candles unavailable", error.message);
    }
  }

  function fillCharts() {
    const data = bars();
    if (!data.length) return;
    priceSeries.setData(data.map(priceBar));
    volumeSeries.setData(data.map(volumeBar));
    maSeries.setData(movingAverage(data));
    kl.setPriceVolumePrecision(config().precision, 2);
    klineViewNeedsReset = true;
    kl.applyNewData(data, false);
    sampleEntry = data.at(-1).close;
    addLevels();
    resetView();
    updateStats();
  }

  function resetView() {
    lw.timeScale().applyOptions({ barSpacing: 7, rightOffset: 10 });
    lw.priceScale("right").applyOptions({ autoScale: true });
    lw.timeScale().scrollToRealTime();
    kl.setBarSpace(7);
    kl.setStyles({ yAxis: { type: "normal" } });
    kl.scrollToRealTime();
    kl.resize();
  }

  function resize() {
    // Hidden charts resize when brought back into view, preserving their data.
    if ($('[data-chart="lightweight"]').offsetWidth) lw.resize($("#lightweight-chart").clientWidth, $("#lightweight-chart").clientHeight);
    if ($('[data-chart="kline"]').offsetWidth) kl.resize();
  }

  function setView(view) {
    state.view = view;
    $(".charts").dataset.view = view;
    $$('[data-view]').filter(el => el.tagName === "BUTTON").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.view === view)));
    $$('[data-focus]').forEach(el => { el.textContent = view === el.dataset.focus ? "⊞" : "⤢"; el.setAttribute("aria-label", view === el.dataset.focus ? "Compare all charts" : `Focus ${el.dataset.focus} chart`); });
    requestAnimationFrame(resize);
  }

  // Same exchange symbol and resolution as the first two panels. The public
  // widget owns its connection, so forming-candle refresh timing can differ.
  function loadTradingView() {
    const generation = ++tvGeneration;
    clearTimeout(tvTimer);
    const host = $("#tradingview-chart");
    host.replaceChildren();
    $("#tv-loading").hidden = false;
    $("#tv-error").hidden = true;
    host.className = "tradingview-widget-container";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.textContent = JSON.stringify({ autosize: true, symbol: config().tv, interval: String(state.interval), timezone: "Etc/UTC", theme: state.theme, style: ({ candles: "1", hollow: "9", bars: "0", line: "3" })[state.style], locale: "en", backgroundColor: colors().plot, gridColor: colors().grid, allow_symbol_change: false, hide_top_toolbar: false, hide_side_toolbar: false, withdateranges: true, save_image: false, calendar: false, details: false, hotlist: false, support_host: "https://www.tradingview.com" });
    const fail = () => {
      if (generation !== tvGeneration) return;
      $("#tv-loading").hidden = true;
      $("#tv-error").hidden = false;
    };
    script.onerror = fail;
    const observer = new MutationObserver(() => {
      const frame = host.querySelector("iframe");
      if (!frame) return;
      frame.title = `TradingView — ${config().tv}, ${state.interval} minute candles`;
      if (generation === tvGeneration) {
        clearTimeout(tvTimer);
        // The iframe has its own loading state; remove our placeholder as
        // soon as it mounts, rather than waiting on every third-party asset.
        $("#tv-loading").hidden = true;
        $("#tv-error").hidden = true;
      }
      observer.disconnect();
    });
    observer.observe(host, { childList: true, subtree: true });
    host.append(script);
    tvTimer = setTimeout(() => { if (!host.querySelector("iframe")) fail(); }, 20000);
  }

  function updatePayout() {
    const value = Number($("#stake").value);
    const valid = Number.isFinite(value) && value >= 1 && value <= 1000000;
    $("#stake").setAttribute("aria-invalid", String(!valid));
    // Work in paise and round the profit down, matching fixed-payout math.
    const stake = Math.round(value * 100);
    const profit = Math.floor(stake * 92 / 100);
    $("#profit").textContent = valid ? `+${money(profit / 100)}` : "—";
    $("#total").textContent = valid ? money((stake + profit) / 100) : "—";
  }

  try {
    lightweight();
    kline();
  } catch (error) {
    notify("A bundled chart could not start. Reload the page to try again.");
    console.error(error);
    return;
  }
  loadTradingView();
  void loadMarketData();
  $$('button[data-view]').forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
  $$('[data-focus]').forEach(button => button.addEventListener("click", () => setView(state.view === button.dataset.focus ? "all" : button.dataset.focus)));
  $$('[data-interval]').forEach(button => button.addEventListener("click", () => {
    state.interval = Number(button.dataset.interval);
    $$('[data-interval]').forEach(el => el.setAttribute("aria-pressed", String(el === button)));
    void loadMarketData();
    loadTradingView();
  }));
  $("#market").addEventListener("change", event => {
    state.market = event.target.value;
    $("#coin").textContent = config().coin;
    kl.removeOverlay();
    setLwSeries();
    void loadMarketData();
    loadTradingView();
  });
  $("#style").addEventListener("change", event => {
    state.style = event.target.value;
    setLwSeries();
    applyKlineStyle();
    if (dataReady) fillCharts();
    loadTradingView();
  });
  $("#theme").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    $("#theme").setAttribute("aria-label", `Switch to ${state.theme === "dark" ? "light" : "dark"} theme`);
    const c = lightweightColors();
    lw.applyOptions({ layout: { background: { color: c.plot }, textColor: c.axis }, grid: { vertLines: { color: c.grid, style: L.LineStyle.Dotted }, horzLines: { color: c.grid, style: L.LineStyle.Dotted } }, crosshair: { vertLine: { color: c.crosshair, labelBackgroundColor: c.crosshairLabel }, horzLine: { color: c.crosshair, labelBackgroundColor: c.crosshairLabel } } });
    applyKlineStyle();
    setLwSeries();
    if (dataReady) fillCharts();
    loadTradingView();
  });
  $("#pause").addEventListener("click", () => {
    void loadMarketData();
    loadTradingView();
  });
  $("#reset").addEventListener("click", resetView);
  $$('[data-ma]').forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.ma;
    state.ma[key] = !state.ma[key];
    button.setAttribute("aria-pressed", String(state.ma[key]));
    if (key === "lightweight") maSeries.applyOptions({ visible: state.ma[key] });
    else if (state.ma[key]) kl.createIndicator({ name: "MA", calcParams: [20] }, false, { id: "candle_pane" });
    else kl.removeIndicator("candle_pane", "MA");
  }));
  $$('[data-levels]').forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.levels;
    state.levels[key] = !state.levels[key];
    button.setAttribute("aria-pressed", String(state.levels[key]));
    if (dataReady) addLevels();
  }));
  $("#draw").addEventListener("click", () => {
    kl.createOverlay({ name: "segment", groupId: "user-drawings" });
    notify("Click two points on KLineChart to draw a trend line.");
  });
  $("#clear-drawings").addEventListener("click", () => { kl.removeOverlay({ groupId: "user-drawings" }); });
  $("#tv-retry").addEventListener("click", loadTradingView);
  $("#stake").addEventListener("input", updatePayout);
  $("#expiry").addEventListener("change", () => notify(`Expiry preview: ${$("#expiry").selectedOptions[0].textContent}. This chart demo does not place trades.`));
  new ResizeObserver(resize).observe($(".charts"));
  updatePayout();

  setInterval(async () => {
    if (document.hidden || polling || !dataReady) return;
    polling = true;
    const generation = dataGeneration;
    const selectedMarket = state.market;
    const selectedInterval = state.interval;
    try {
      const before = markets[selectedMarket].candles(selectedInterval).at(-1)?.timestamp;
      const data = await markets[selectedMarket].refresh(selectedInterval);
      if (generation !== dataGeneration || !dataReady) return;
      // Reapply every overlapping bar, including the just-closed one, so a
      // poll crossing a minute boundary cannot leave its final OHLC stale.
      for (const bar of data.filter(bar => before === undefined || bar.timestamp >= before)) {
        priceSeries.update(priceBar(bar));
        volumeSeries.update(volumeBar(bar));
        kl.updateData({ ...bar });
      }
      maSeries.setData(movingAverage(data));
      updateStats();
      $("#stream-label").textContent = "Live Bitstamp feed";
    } catch (error) {
      if (generation === dataGeneration) {
        $("#stream-label").textContent = "Reconnecting to Bitstamp";
        $("#feed-status").textContent = `Showing the last received exchange candles; the next refresh will retry. ${error.message}`;
      }
    } finally { polling = false; }
  }, 5000);

  // Read-only state for checking the demo, never connected to live trading.
  window.asmChartDemo = { state, markets, bars, get lightweight() { return lw; }, get kline() { return kl; } };
})();
