/* ASM demo engine — shared by every theme demo.
 * Simulated feed, canvas candle chart, trade ticket, open/closed trades,
 * Live/Demo accounts, and the deposit → UPI checkout → processing flow.
 * Themes own all markup and CSS; this file only binds to the DOM contract:
 *   data-bind="…"   text targets        data-action="…"  click targets
 *   data-view="…"   screens              data-view-link="…" rail links
 *   #chart canvas, #assetTabs, #durationGrid, #tradeList, #paymentList, #qr
 * Colours are read from CSS custom properties on :root, so the chart and QR
 * follow the theme (see readTheme()). A theme may define window.ASMTheme with
 * setText(el, text) to animate bound values (e.g. split-flap digits).
 */
(function () {
  "use strict";

  var DURATIONS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
  var CANDLE_MS = 5000; // simulated 5-second candles so the demo moves
  var TICK_MS = 250;
  var USD_TO_INR = 107.64;

  var ASSETS = [
    { sym: "EUR/USD", name: "Euro / US Dollar", payout: 92, price: 1.08432, prec: 5, vol: 0.00006 },
    { sym: "USD/JPY", name: "US Dollar / Yen", payout: 88, price: 156.412, prec: 3, vol: 0.00007 },
    { sym: "BTC/USD", name: "Bitcoin", payout: 85, price: 64210.5, prec: 1, vol: 0.00018 },
    { sym: "XAU/USD", name: "Gold", payout: 80, price: 2331.42, prec: 2, vol: 0.0001 },
  ];

  var state = {
    account: "demo",
    balances: { live: 1240.5, demo: 10000 },
    activeSym: "EUR/USD",
    openTabs: ["EUR/USD", "USD/JPY", "BTC/USD"],
    duration: 30,
    stake: 10,
    trades: [],
    tradesTab: "open",
    hover: null,
    view: "trade",
    dep: { step: 1, usd: 50, method: "upi", offsetPaise: 37, startedAt: 0 },
    payments: [
      { id: "D-20931", kind: "Deposit", method: "UPI", usd: 100, status: "approved", when: "12 Sep, 21:04" },
      { id: "W-11820", kind: "Withdrawal", method: "UPI", usd: 60, status: "approved", when: "10 Sep, 18:47" },
      { id: "D-20514", kind: "Deposit", method: "PhonePe", usd: 25, status: "rejected", when: "08 Sep, 09:12", note: "UTR did not match" },
    ],
  };

  var series = {}; // sym -> { candles: [], last }
  var nextId = 1;

  // ---------- utils ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function asset(sym) { return ASSETS.filter(function (a) { return a.sym === sym; })[0]; }
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function money(n) {
    var sign = n < 0 ? "−" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function inr(paise) {
    return "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function clock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }
  function shortDur(sec) {
    if (sec < 60) return "0:" + pad(sec);
    if (sec < 3600) return (sec / 60) + ":00";
    return (sec / 3600) + "h";
  }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function hhmmss(t) { var d = new Date(t); return hhmm(t) + ":" + pad(d.getSeconds()); }

  function setText(el, text) {
    if (!el) return;
    text = String(text);
    if (el.__v === text) return;
    el.__v = text;
    if (window.ASMTheme && window.ASMTheme.setText && el.hasAttribute("data-flap")) {
      window.ASMTheme.setText(el, text);
    } else {
      el.textContent = text;
    }
  }
  function bind(name, text) { $all('[data-bind="' + name + '"]').forEach(function (el) { setText(el, text); }); }

  // ---------- feed ----------
  function seed(a) {
    var candles = [];
    var t = Math.floor(Date.now() / CANDLE_MS) * CANDLE_MS - 140 * CANDLE_MS;
    var p = a.price;
    for (var i = 0; i < 140; i++) {
      var o = p, h = o, l = o;
      for (var k = 0; k < 20; k++) {
        p = p * (1 + gauss() * a.vol + (a.price - p) / a.price * 0.004);
        h = Math.max(h, p); l = Math.min(l, p);
      }
      candles.push({ t: t + i * CANDLE_MS, o: o, h: h, l: l, c: p });
    }
    series[a.sym] = { candles: candles, last: p, prev: p };
  }

  function tick() {
    var now = Date.now();
    ASSETS.forEach(function (a) {
      var s = series[a.sym];
      var p = s.last * (1 + gauss() * a.vol + (a.price - s.last) / a.price * 0.003);
      s.prev = s.last; s.last = p;
      var bucket = Math.floor(now / CANDLE_MS) * CANDLE_MS;
      var cur = s.candles[s.candles.length - 1];
      if (cur.t !== bucket) {
        cur = { t: bucket, o: cur.c, h: cur.c, l: cur.c, c: cur.c };
        s.candles.push(cur);
        if (s.candles.length > 400) s.candles.shift();
      }
      cur.c = p; cur.h = Math.max(cur.h, p); cur.l = Math.min(cur.l, p);
    });
    settle(now);
    renderLive(now);
    drawChart();
  }

  // ---------- trades ----------
  function place(dir) {
    var bal = state.balances[state.account];
    var stake = Number(state.stake);
    if (!(stake >= 1)) return ticketError("Enter an investment of at least $1.");
    if (stake > bal) return ticketError("Not enough balance on your " + (state.account === "live" ? "Live" : "Demo") + " account.");
    ticketError(null);
    var a = asset(state.activeSym);
    var now = Date.now();
    state.balances[state.account] = bal - stake;
    var trade = {
      id: nextId++, sym: a.sym, dir: dir, stake: stake, payout: a.payout, account: state.account,
      entry: series[a.sym].last, openedAt: now, expiresAt: now + state.duration * 1000, status: "open", pnl: 0,
    };
    state.trades.unshift(trade);
    state.tradesTab = "open";
    renderTrades(); renderAccount();
    var btn = $('[data-action="' + dir + '"]');
    if (btn) { btn.classList.remove("is-fired"); void btn.offsetWidth; btn.classList.add("is-fired"); }
  }

  function settle(now) {
    var changed = false;
    state.trades.forEach(function (t) {
      if (t.status !== "open" || now < t.expiresAt) return;
      var close = series[t.sym].last;
      var won = t.dir === "up" ? close > t.entry : close < t.entry;
      var tie = close === t.entry;
      t.close = close;
      if (tie) { t.status = "refund"; t.pnl = 0; state.balances[t.account] += t.stake; }
      else if (won) { t.status = "won"; t.pnl = Math.floor(t.stake * t.payout) / 100; state.balances[t.account] += t.stake + t.pnl; }
      else { t.status = "lost"; t.pnl = -t.stake; }
      t.justSettled = true;
      changed = true;
    });
    if (changed) { renderTrades(); renderAccount(); }
  }

  function ticketError(msg) {
    var el = $("#ticketError");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  // ---------- render ----------
  function renderTabs() {
    var root = $("#assetTabs");
    if (!root) return;
    root.innerHTML = "";
    state.openTabs.forEach(function (sym) {
      var a = asset(sym);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "asset-tab" + (sym === state.activeSym ? " is-active" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", sym === state.activeSym ? "true" : "false");
      b.innerHTML = '<span class="asset-tab__sym"></span><span class="asset-tab__pay"></span>';
      b.children[0].textContent = a.sym;
      b.children[1].textContent = a.payout + "%";
      b.addEventListener("click", function () { state.activeSym = sym; renderTabs(); renderTicketAsset(); drawChart(); });
      root.appendChild(b);
    });
  }

  function renderTicketAsset() {
    var a = asset(state.activeSym);
    bind("asset", a.sym);
    bind("asset-name", a.name);
    bind("payout-pct", a.payout + "%");
    renderProfit();
  }

  function renderProfit() {
    var a = asset(state.activeSym);
    var stake = Number(state.stake) || 0;
    var profit = Math.floor(stake * a.payout) / 100;
    bind("profit", "+" + money(profit));
    bind("return", money(stake + profit));
  }

  function renderDuration() {
    bind("duration", clock(state.duration));
    $all(".dur-chip").forEach(function (c) {
      var on = Number(c.dataset.sec) === state.duration;
      c.classList.toggle("is-active", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function renderAccount() {
    var live = state.account === "live";
    document.documentElement.dataset.account = state.account;
    bind("account-label", live ? "Live account" : "Demo account");
    bind("account-short", live ? "LIVE" : "DEMO");
    bind("balance", money(state.balances[state.account]));
    bind("balance-live", money(state.balances.live));
    bind("balance-demo", money(state.balances.demo));
    $all('[data-action="switch-account"]').forEach(function (b) {
      var on = b.dataset.account === state.account;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function renderLive(now) {
    var a = asset(state.activeSym);
    var s = series[a.sym];
    bind("price", s.last.toFixed(a.prec));
    var dirEl = $all('[data-bind-dir="price"]');
    dirEl.forEach(function (el) { el.dataset.dir = s.last >= s.prev ? "up" : "down"; });
    bind("utc", hhmmss(now));
    // expiry preview in ticket
    bind("expires-at", hhmmss(now + state.duration * 1000));
    // open trade countdowns
    state.trades.forEach(function (t) {
      if (t.status !== "open") return;
      var row = $('[data-trade-id="' + t.id + '"]');
      if (!row) return;
      setText($(".trade-row__time", row), clock((t.expiresAt - now) / 1000));
      var cur = series[t.sym].last;
      var winning = t.dir === "up" ? cur > t.entry : cur < t.entry;
      row.dataset.leaning = winning ? "win" : "lose";
      var prog = $(".trade-row__progress", row);
      if (prog) prog.style.setProperty("--p", Math.min(1, (now - t.openedAt) / (t.expiresAt - t.openedAt)).toFixed(3));
      setText($(".trade-row__pnl", row), winning ? "+" + money(Math.floor(t.stake * t.payout) / 100) : money(-t.stake));
    });
    // deposit processing timer
    if (state.dep.step === 3) bind("dep-elapsed", clock((now - state.dep.startedAt) / 1000));
    // sentiment drift
    var up = 50 + Math.round(Math.sin(now / 9000 + a.payout) * 18);
    bind("sent-up", up + "%");
    bind("sent-down", (100 - up) + "%");
    $all("[data-sentiment]").forEach(function (el) { el.style.setProperty("--sent-up", up / 100); });
  }

  function renderTrades() {
    var list = $("#tradeList");
    if (!list) return;
    var mine = state.trades.filter(function (t) { return t.account === state.account; });
    var open = mine.filter(function (t) { return t.status === "open"; });
    var closed = mine.filter(function (t) { return t.status !== "open"; });
    bind("count-open", open.length);
    bind("count-closed", closed.length);
    $all('[data-action="trades-tab"]').forEach(function (b) {
      var on = b.dataset.tab === state.tradesTab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var rows = state.tradesTab === "open" ? open : closed;
    list.innerHTML = "";
    if (!rows.length) {
      var empty = $("#tradesEmpty");
      if (empty) { var c = empty.content.cloneNode(true); list.appendChild(c); }
      bind("empty-tab", state.tradesTab === "open" ? "open" : "closed");
      return;
    }
    rows.forEach(function (t) {
      var a = asset(t.sym);
      var li = document.createElement("li");
      li.className = "trade-row";
      li.dataset.tradeId = t.id;
      li.dataset.dir = t.dir;
      li.dataset.state = t.status;
      if (t.justSettled) { li.classList.add("is-settling"); t.justSettled = false; }
      var statusWord = { open: "Open", won: "Won", lost: "Lost", refund: "Refund" }[t.status];
      li.innerHTML =
        '<span class="trade-row__dir" aria-hidden="true">' + (t.dir === "up" ? "▲" : "▼") + "</span>" +
        '<span class="trade-row__sym"></span>' +
        '<span class="trade-row__stake"></span>' +
        '<span class="trade-row__time"></span>' +
        '<span class="trade-row__status"></span>' +
        '<span class="trade-row__pnl"></span>' +
        '<span class="trade-row__meta"></span>' +
        (t.status === "open" ? '<span class="trade-row__progress" aria-hidden="true"></span>' : "");
      $(".trade-row__sym", li).textContent = t.sym;
      $(".trade-row__stake", li).textContent = (t.dir === "up" ? "Up " : "Down ") + money(t.stake);
      $(".trade-row__status", li).textContent = statusWord;
      $(".trade-row__meta", li).textContent =
        "Entry " + t.entry.toFixed(a.prec) + (t.close != null ? " → " + t.close.toFixed(a.prec) : "") + " · " + t.payout + "%";
      var timeEl = $(".trade-row__time", li);
      var pnlEl = $(".trade-row__pnl", li);
      if (t.status === "open") {
        timeEl.textContent = clock((t.expiresAt - Date.now()) / 1000);
        timeEl.setAttribute("data-flap", "");
      } else {
        timeEl.textContent = hhmmss(t.expiresAt);
        pnlEl.textContent = t.pnl > 0 ? "+" + money(t.pnl) : t.pnl < 0 ? money(t.pnl) : money(0);
      }
      list.appendChild(li);
    });
  }

  // ---------- chart ----------
  var theme = {};
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, d) { var x = cs.getPropertyValue(n).trim(); return x || d; }
    theme = {
      bg: v("--chart-bg", "#000"),
      grid: v("--chart-grid", "rgba(255,255,255,.06)"),
      text: v("--chart-text", "#8a8f98"),
      up: v("--up", "#2fd08a"),
      down: v("--down", "#ff5a47"),
      upHollow: v("--candle-up-hollow", "0") === "1",
      priceLine: v("--chart-price-line", "#f5c518"),
      priceLabelBg: v("--chart-price-label-bg", "#f5c518"),
      priceLabelText: v("--chart-price-label-text", "#000"),
      entry: v("--chart-entry", "#efe9dc"),
      watermark: v("--chart-watermark", "rgba(255,255,255,.035)"),
      crosshair: v("--chart-crosshair", "rgba(255,255,255,.25)"),
      font: v("--font-num", "ui-monospace, monospace"),
      fontUi: v("--font-ui", "system-ui, sans-serif"),
      qrDark: v("--qr-dark", "#000"),
      qrLight: v("--qr-light", "#fff"),
    };
  }

  var canvas, ctx, geo = null;
  function sizeCanvas() {
    if (!canvas) return;
    var r = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart();
  }

  function niceStep(range, count) {
    var raw = range / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function drawChart() {
    if (!canvas || state.view !== "trade") return;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    var a = asset(state.activeSym), s = series[a.sym];
    var axisW = 78, axisH = 26, padTop = 18;
    var plotW = W - axisW, plotH = H - axisH - padTop;
    var step = 11, cw = 7;
    var future = 14; // empty slots to the right, like expiry space
    var count = Math.max(10, Math.floor(plotW / step) - future);
    var cs = s.candles.slice(-count);
    var mine = state.trades.filter(function (t) { return t.sym === a.sym && t.account === state.account && t.status === "open"; });
    var lo = Infinity, hi = -Infinity;
    cs.forEach(function (c) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
    mine.forEach(function (t) { lo = Math.min(lo, t.entry); hi = Math.max(hi, t.entry); });
    var padP = (hi - lo) * 0.12 || a.price * 0.0005;
    lo -= padP; hi += padP;
    function y(p) { return padTop + (hi - p) / (hi - lo) * plotH; }
    var x0 = 0;
    function x(i) { return x0 + i * step + step / 2; }
    geo = { cs: cs, x: x, step: step, plotW: plotW, plotH: plotH, padTop: padTop, lo: lo, hi: hi, a: a };

    ctx.clearRect(0, 0, W, H);

    // watermark
    ctx.save();
    ctx.fillStyle = theme.watermark;
    ctx.font = "700 " + Math.round(Math.min(plotW / 4.2, plotH / 1.6)) + "px " + theme.fontUi;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(state.account === "demo" ? "DEMO" : "", plotW / 2, padTop + plotH / 2);
    ctx.restore();

    // grid + price axis
    ctx.font = "500 11px " + theme.font;
    ctx.textBaseline = "middle";
    var ps = niceStep(hi - lo, 6);
    ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
    for (var p = Math.ceil(lo / ps) * ps; p <= hi; p += ps) {
      var yy = Math.round(y(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
      ctx.fillStyle = theme.text; ctx.textAlign = "left";
      ctx.fillText(p.toFixed(a.prec), plotW + 10, yy);
    }
    // time grid
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    for (var i = 0; i < cs.length + future; i++) {
      var t = (cs[0] ? cs[0].t : Date.now()) + i * CANDLE_MS;
      if (Math.floor(t / CANDLE_MS) % 12 !== 0) continue;
      var xx = Math.round(x(i)) + 0.5;
      if (xx < 34 || xx > plotW - 30) continue;
      ctx.beginPath(); ctx.moveTo(xx, padTop); ctx.lineTo(xx, padTop + plotH); ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.fillText(hhmmss(t), xx, H - 8);
    }

    // candles
    cs.forEach(function (c, i) {
      var up = c.c >= c.o;
      var col = up ? theme.up : theme.down;
      var cx = Math.round(x(i)) + 0.5;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y(c.h)); ctx.lineTo(cx, y(c.l)); ctx.stroke();
      var top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
      var bh = Math.max(1, bot - top);
      var bx = Math.round(cx - cw / 2);
      if (up && theme.upHollow) {
        ctx.fillStyle = theme.bg;
        ctx.fillRect(bx, top, cw, bh);
        ctx.strokeRect(bx + 0.5, Math.round(top) + 0.5, cw - 1, Math.max(1, bh - 1));
      } else {
        ctx.fillRect(bx, top, cw, bh);
      }
    });

    var lastX = x(cs.length - 1);

    // open trades: entry line + expiry marker
    mine.forEach(function (t) {
      var ey = Math.round(y(t.entry)) + 0.5;
      var col = t.dir === "up" ? theme.up : theme.down;
      var ox = x(cs.length - 1 - Math.round((Date.now() - t.openedAt) / CANDLE_MS));
      var ex = lastX + (t.expiresAt - Date.now()) / CANDLE_MS * step;
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(Math.max(0, ox), ey); ctx.lineTo(Math.min(plotW, ex), ey); ctx.stroke();
      if (ex < plotW) {
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(Math.round(ex) + 0.5, padTop); ctx.lineTo(Math.round(ex) + 0.5, padTop + plotH); ctx.stroke();
        ctx.setLineDash([]);
      }
      var label = (t.dir === "up" ? "▲ " : "▼ ") + "$" + t.stake;
      ctx.font = "700 11px " + theme.font;
      var lw = ctx.measureText(label).width + 12;
      var lx = Math.max(2, Math.min(plotW - lw - 2, ox - lw - 4));
      ctx.fillStyle = col;
      ctx.fillRect(lx, ey - 9, lw, 18);
      ctx.fillStyle = theme.priceLabelText;
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(label, lx + 6, ey + 0.5);
      ctx.restore();
    });

    // last price line + label
    var ly = Math.round(y(s.last)) + 0.5;
    ctx.save();
    ctx.strokeStyle = theme.priceLine; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(plotW, ly); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = theme.priceLabelBg;
    ctx.fillRect(plotW + 2, ly - 11, axisW - 4, 22);
    ctx.fillStyle = theme.priceLabelText;
    ctx.font = "700 11px " + theme.font; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(s.last.toFixed(a.prec), plotW + 8, ly + 0.5);
    // candle countdown
    var left = Math.ceil((CANDLE_MS - (Date.now() % CANDLE_MS)) / 1000);
    ctx.font = "600 10px " + theme.font;
    var cd = "00:0" + left;
    var cdw = ctx.measureText(cd).width + 10;
    ctx.fillStyle = theme.priceLabelBg;
    ctx.fillRect(lastX + 14, ly - 9, cdw, 18);
    ctx.fillStyle = theme.priceLabelText;
    ctx.fillText(cd, lastX + 19, ly + 0.5);
    ctx.restore();

    // crosshair
    if (state.hover) {
      var hx = state.hover.x, hy = state.hover.y;
      if (hx < plotW && hy > padTop && hy < padTop + plotH) {
        ctx.save();
        ctx.strokeStyle = theme.crosshair; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(hx + 0.5, padTop); ctx.lineTo(hx + 0.5, padTop + plotH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, hy + 0.5); ctx.lineTo(plotW, hy + 0.5); ctx.stroke();
        ctx.restore();
        var idx = Math.floor(hx / step);
        var c = cs[idx];
        if (c) {
          bind("ohlc", "O " + c.o.toFixed(a.prec) + "  H " + c.h.toFixed(a.prec) + "  L " + c.l.toFixed(a.prec) + "  C " + c.c.toFixed(a.prec));
        }
      }
    }
  }

  // ---------- deposit / checkout ----------
  function depPaise() { return Math.round(state.dep.usd * 100 * USD_TO_INR) + state.dep.offsetPaise; }
  function renderDeposit() {
    var flow = $("#depositFlow");
    if (!flow) return;
    flow.dataset.current = state.dep.step;
    $all("[data-step]", flow).forEach(function (el) {
      var n = Number(el.dataset.step);
      el.dataset.status = n < state.dep.step ? "done" : n === state.dep.step ? "current" : "todo";
    });
    $all("[data-step-panel]").forEach(function (el) { el.hidden = Number(el.dataset.stepPanel) !== state.dep.step; });
    var inp = $("#depAmount");
    if (inp && document.activeElement !== inp) inp.value = state.dep.usd;
    bind("dep-usd", money(state.dep.usd));
    bind("dep-inr", inr(depPaise()));
    bind("dep-rate", "1 USD = ₹" + USD_TO_INR.toFixed(2));
    bind("dep-method", { upi: "UPI", phonepe: "PhonePe", paytm: "Paytm" }[state.dep.method]);
    $all('[data-action="dep-amount"]').forEach(function (b) { b.classList.toggle("is-active", Number(b.dataset.amount) === state.dep.usd); });
    $all('[data-action="dep-method"]').forEach(function (b) {
      var on = b.dataset.method === state.dep.method;
      b.classList.toggle("is-active", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    var err = $("#depError");
    var bad = !(state.dep.usd >= 10 && state.dep.usd <= 961);
    if (err) { err.hidden = !bad; err.textContent = bad ? "Deposits are between $10.00 and $961.00." : ""; }
    var cont = $('[data-action="dep-continue"]');
    if (cont) cont.disabled = bad;
    if (state.dep.step === 2) drawQR();
    renderPayments();
  }

  function renderPayments() {
    var list = $("#paymentList");
    if (!list) return;
    list.innerHTML = "";
    state.payments.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "pay-row";
      li.dataset.state = p.status;
      var word = { processing: "Processing", approved: "Approved", rejected: "Rejected" }[p.status];
      var glyph = { processing: "◷", approved: "✓", rejected: "✕" }[p.status];
      li.innerHTML =
        '<span class="pay-row__glyph" aria-hidden="true">' + glyph + "</span>" +
        '<span class="pay-row__kind"></span><span class="pay-row__id"></span>' +
        '<span class="pay-row__amount"></span><span class="pay-row__status"></span>' +
        '<span class="pay-row__when"></span>' + (p.note ? '<span class="pay-row__note"></span>' : "");
      $(".pay-row__kind", li).textContent = p.kind + " · " + p.method;
      $(".pay-row__id", li).textContent = p.id;
      $(".pay-row__amount", li).textContent = (p.kind === "Withdrawal" ? "−" : "+") + money(p.usd);
      $(".pay-row__status", li).textContent = word;
      $(".pay-row__when", li).textContent = p.when;
      if (p.note) $(".pay-row__note", li).textContent = p.note;
      list.appendChild(li);
    });
  }

  function drawQR() {
    var c = $("#qr");
    if (!c) return;
    var n = 33, cell = 6, size = n * cell;
    var dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = size + "px"; c.style.height = size + "px";
    var g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = theme.qrLight; g.fillRect(0, 0, size, size);
    g.fillStyle = theme.qrDark;
    var seedN = depPaise();
    function rnd(i) { var v = Math.sin(i * 12.9898 + seedN * 0.001) * 43758.5453; return v - Math.floor(v); }
    function finder(fx, fy) {
      g.fillRect(fx * cell, fy * cell, 7 * cell, 7 * cell);
      g.fillStyle = theme.qrLight; g.fillRect((fx + 1) * cell, (fy + 1) * cell, 5 * cell, 5 * cell);
      g.fillStyle = theme.qrDark; g.fillRect((fx + 2) * cell, (fy + 2) * cell, 3 * cell, 3 * cell);
    }
    for (var yy = 0; yy < n; yy++) for (var xx = 0; xx < n; xx++) {
      var inF = (xx < 8 && yy < 8) || (xx > n - 9 && yy < 8) || (xx < 8 && yy > n - 9);
      if (!inF && rnd(yy * n + xx) > 0.52) g.fillRect(xx * cell, yy * cell, cell, cell);
    }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  }

  // ---------- views ----------
  function setView(v) {
    state.view = v;
    $all("[data-view]").forEach(function (el) { el.hidden = el.dataset.view !== v; });
    $all("[data-view-link]").forEach(function (el) {
      var on = el.dataset.viewLink === v;
      el.classList.toggle("is-active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    closeMenu();
    if (v === "trade") requestAnimationFrame(sizeCanvas);
    if (v === "deposit") renderDeposit();
  }

  function closeMenu() {
    var m = $("#accountMenu");
    if (m) m.hidden = true;
    $all('[data-action="account-menu"]').forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
  }

  // ---------- events ----------
  function onClick(e) {
    var el = e.target.closest("[data-action], [data-view-link]");
    if (!el) {
      if (!e.target.closest("#accountMenu")) closeMenu();
      return;
    }
    if (el.hasAttribute("data-view-link")) {
      if (el.getAttribute("aria-disabled") === "true") return;
      e.preventDefault(); setView(el.dataset.viewLink); return;
    }
    var act = el.dataset.action;
    var i;
    switch (act) {
      case "up": case "down": place(act); break;
      case "stake-minus": state.stake = Math.max(1, Math.floor(Number(state.stake) || 1) - 1); syncStake(); break;
      case "stake-plus": state.stake = Math.floor(Number(state.stake) || 0) + 1; syncStake(); break;
      case "stake-preset": state.stake = Number(el.dataset.value); syncStake(); break;
      case "dur-minus": i = DURATIONS.indexOf(state.duration); state.duration = DURATIONS[Math.max(0, i - 1)]; renderDuration(); break;
      case "dur-plus": i = DURATIONS.indexOf(state.duration); state.duration = DURATIONS[Math.min(DURATIONS.length - 1, i + 1)]; renderDuration(); break;
      case "dur-set": state.duration = Number(el.dataset.sec); renderDuration(); toggleDurGrid(false); break;
      case "dur-toggle": toggleDurGrid(); break;
      case "trades-tab": state.tradesTab = el.dataset.tab; renderTrades(); break;
      case "account-menu": {
        var m = $("#accountMenu");
        if (m) { m.hidden = !m.hidden; el.setAttribute("aria-expanded", m.hidden ? "false" : "true"); }
        break;
      }
      case "switch-account": state.account = el.dataset.account; renderAccount(); renderTrades(); drawChart(); closeMenu(); break;
      case "reset-demo": state.balances.demo = 10000; renderAccount(); break;
      case "add-tab": {
        var next = ASSETS.filter(function (a) { return state.openTabs.indexOf(a.sym) < 0; })[0];
        if (next) { state.openTabs.push(next.sym); state.activeSym = next.sym; renderTabs(); renderTicketAsset(); drawChart(); }
        break;
      }
      case "dep-amount": state.dep.usd = Number(el.dataset.amount); renderDeposit(); break;
      case "dep-method": state.dep.method = el.dataset.method; renderDeposit(); break;
      case "dep-continue": state.dep.step = 2; state.dep.offsetPaise = 1 + Math.floor(Math.random() * 98); renderDeposit(); break;
      case "dep-back": state.dep.step = Math.max(1, state.dep.step - 1); renderDeposit(); break;
      case "dep-copy": {
        var t = el.dataset.copy || "";
        if (navigator.clipboard) navigator.clipboard.writeText(t).catch(function () {});
        el.classList.add("is-copied");
        setTimeout(function () { el.classList.remove("is-copied"); }, 1400);
        break;
      }
      case "dep-claim": {
        var utr = ($("#utr") || {}).value || "";
        var ue = $("#utrError");
        if (!/^\d{12}$/.test(utr.trim())) {
          if (ue) { ue.hidden = false; ue.textContent = "A UTR is the 12-digit reference in your UPI app’s payment details."; }
          return;
        }
        if (ue) ue.hidden = true;
        state.dep.step = 3; state.dep.startedAt = Date.now();
        state.payments.unshift({ id: "D-" + (21000 + Math.floor(Math.random() * 900)), kind: "Deposit", method: { upi: "UPI", phonepe: "PhonePe", paytm: "Paytm" }[state.dep.method], usd: state.dep.usd, status: "processing", when: "Just now" });
        renderDeposit();
        break;
      }
      case "dep-restart": state.dep.step = 1; renderDeposit(); break;
      case "goto": setView(el.dataset.target); break;
    }
  }

  function toggleDurGrid(force) {
    var g = $("#durationGrid");
    if (!g) return;
    g.hidden = force === undefined ? !g.hidden : !force;
    $all('[data-action="dur-toggle"]').forEach(function (b) { b.setAttribute("aria-expanded", g.hidden ? "false" : "true"); });
  }

  function syncStake() {
    var inp = $("#stakeInput");
    if (inp && document.activeElement !== inp) inp.value = state.stake;
    $all('[data-action="stake-preset"]').forEach(function (b) { b.classList.toggle("is-active", Number(b.dataset.value) === Number(state.stake)); });
    renderProfit();
  }

  function buildDurGrid() {
    var g = $("#durationGrid");
    if (!g) return;
    g.innerHTML = "";
    DURATIONS.forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "dur-chip"; b.dataset.action = "dur-set"; b.dataset.sec = d;
      b.textContent = clock(d).replace(/^00:/, "");
      g.appendChild(b);
    });
  }

  function init() {
    ASSETS.forEach(seed);
    readTheme();
    canvas = $("#chart");
    if (canvas) {
      ctx = canvas.getContext("2d");
      if (window.ResizeObserver) new ResizeObserver(sizeCanvas).observe(canvas.parentElement);
      canvas.addEventListener("mousemove", function (e) {
        var r = canvas.getBoundingClientRect();
        state.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      });
      canvas.addEventListener("mouseleave", function () { state.hover = null; bind("ohlc", ""); });
    }
    buildDurGrid();
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeMenu(); toggleDurGrid(false); } });
    var si = $("#stakeInput");
    if (si) si.addEventListener("input", function () { state.stake = si.value; syncStake(); });
    var da = $("#depAmount");
    if (da) da.addEventListener("input", function () { state.dep.usd = Number(da.value); renderDeposit(); });
    var utr = $("#utr");
    if (utr) utr.addEventListener("input", function () { utr.value = utr.value.replace(/\D/g, "").slice(0, 12); });

    // Seed two closed trades per account so history is never a blank first look.
    var now = Date.now();
    [["demo", "EUR/USD", "up", 25, "won"], ["demo", "USD/JPY", "down", 10, "lost"], ["live", "EUR/USD", "down", 5, "won"]].forEach(function (s, k) {
      var a = asset(s[1]);
      var entry = series[a.sym].candles[100 + k].c;
      state.trades.push({
        id: nextId++, sym: s[1], dir: s[2], stake: s[3], payout: a.payout, account: s[0], entry: entry,
        close: entry * (s[4] === "won" === (s[2] === "up") ? 1.0002 : 0.9998),
        openedAt: now - (600 - k * 60) * 1000, expiresAt: now - (540 - k * 60) * 1000,
        status: s[4], pnl: s[4] === "won" ? Math.floor(s[3] * a.payout) / 100 : -s[3],
      });
    });

    renderTabs(); renderTicketAsset(); renderDuration(); renderAccount(); renderTrades(); syncStake();
    setView(location.hash === "#deposit" ? "deposit" : "trade");
    tick();
    setInterval(tick, TICK_MS);
    window.addEventListener("hashchange", function () { setView(location.hash === "#deposit" ? "deposit" : "trade"); });
  }

  window.ASMDemo = {
    state: state,
    assets: ASSETS,
    /** { sym, name, payout, prec, price, prev, changePct } — changePct vs the oldest loaded candle. */
    quote: function (sym) {
      var a = asset(sym), s = series[sym];
      if (!a || !s) return null;
      var base = s.candles[0].o;
      return { sym: a.sym, name: a.name, payout: a.payout, prec: a.prec, price: s.last, prev: s.prev, changePct: (s.last - base) / base * 100 };
    },
    readTheme: function () { readTheme(); drawChart(); drawQR(); },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
