import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  LinearGradient,
  Line,
  Path,
  Skia,
  vec,
} from "@shopify/react-native-skia";
import { type ReactNode, memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { shortCountdown } from "@asm/client-core";
import { TIMEFRAME_SEC, type Timeframe, type CandleDto, type TradeView } from "@asm/contracts";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { FigText } from "@/ui/FigText";
import { firstCandleShift, frontChanged, isFollowing, shouldRequestOlder, type EdgeState } from "./live";
import { fmtPrice } from "./format-price";
import { buildSeries, type SeriesPaths } from "./paths";
import { indexForX, nearLeftEdge, priceRange, shiftForPrepend, visibleRange, xForIndex, yForPrice, rightLimit, zoomAround } from "./scale";
import { entryIndex, entryBucketIndex, gridYs, readoutBox, showReadout } from "./tag-layout";
import type { ChartType, PriceRange, Viewport } from "./types";
import { useChartGestures } from "./useChartGestures";
import { ProtectionHandle } from "./ProtectionHandle";
import type { Protection } from "@/trade/otc-protection";
import { selectedOpen } from "@/trade/selected-open";
import { useHistoryCommit } from "./useHistoryCommit";

const PRICE_AXIS = 12;
const DEFAULT_VISIBLE = 60;
const EMPTY: SeriesPaths = { up: "", down: "" };
/** Dash pattern of the last-price line (hoisted: a fresh array per render would re-create the effect). */
const PRICE_DASH = [4, 3];

/** What the chart needs of an open trade. */
export type ChartTrade = TradeView;
const DEFAULT_LABEL = (tr: ChartTrade, nowSec: number) => shortCountdown(Math.max(0, tr.expiryTs - nowSec));

export interface ChartProps {
  priceReadout?: ReactNode;
  timeframe?: Timeframe;
  protection?: Protection;
  onProtectionPrice?: (side: "stopLoss" | "takeProfit", price: number) => void;
  type: ChartType;
  /** Closed candles, oldest first. */
  candles: CandleDto[];
  forming: CandleDto | null;
  lastPrice: number | null;
  precision: number;
  openTrades: TradeView[];
  selectedTradeId?: string | null;
  /** Epoch seconds, for the open-trade countdowns. */
  nowSec: number;
  /** The trade line's countdown text. Default: the plain countdown; the Trade screen says "Settling…" after expiry. */
  labelFor?: (trade: ChartTrade, nowSec: number) => string;
  /** Top of the crosshair's OHLC readout: just below the screen's overlay row. */
  topInset?: number;
  /** Hide the readout (the chart-tools panel is open over its spot). */
  hideReadout?: boolean;
  onNearLeftEdge: () => void;
}

interface ViewState {
  rightIndex: number;
  visibleCount: number;
  /** Glued to the live edge: `rightIndex` is then `total`, whatever it holds. */
  following: boolean;
}

/** Parses an SVG path once per distinct string. Empty strings (and parse failures) give no path. */
function useSkPath(d: string | undefined) {
  return useMemo(() => (d ? Skia.Path.MakeFromSVGString(d) : null), [d]);
}

/** One set of series paths; the parsed paths are cached per string. */
const SeriesLayer = memo(function SeriesLayer({ type, series, height }: { type: ChartType; series: SeriesPaths; height: number }) {
  const up = useSkPath(series.up);
  const down = useSkPath(series.down);
  const upWicks = useSkPath(series.upWicks);
  const downWicks = useSkPath(series.downWicks);
  const line = useSkPath(series.line);
  const area = useSkPath(series.area);

  if (type === "line" || type === "area") {
    return (
      <>
        {area ? (
          <Path path={area}>
            <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[`${color.accent}66`, `${color.accent}00`]} />
          </Path>
        ) : null}
        {line ? <Path path={line} style="stroke" strokeWidth={1.5} strokeJoin="round" color={color.accent} /> : null}
      </>
    );
  }
  if (type === "bars") {
    return (
      <>
        {up ? <Path path={up} style="stroke" strokeWidth={1.5} color="#089981" /> : null}
        {down ? <Path path={down} style="stroke" strokeWidth={1.5} color="#f23645" /> : null}
      </>
    );
  }
  // Candles: bodies filled (a wick has no area, so it does not paint), wicks stroked separately.
  return (
    <>
      {up ? <Path path={up} style="fill" color="#089981" /> : null}
      {down ? <Path path={down} style="fill" color="#f23645" /> : null}
      {upWicks ? <Path path={upWicks} style="stroke" strokeWidth={1} color="#089981" /> : null}
      {downWicks ? <Path path={downWicks} style="stroke" strokeWidth={1} color="#f23645" /> : null}
    </>
  );
});

/** Three faint horizontal rules under the candles. One path, parsed once per size. */
const GridLayer = memo(function GridLayer({ plotW, height }: { plotW: number; height: number }) {
  const d = useMemo(() => gridYs(height).map((y) => `M0 ${Math.round(y) + 0.5} H${plotW}`).join(" "), [plotW, height]);
  const grid = useSkPath(d);
  return grid ? <Path path={grid} style="stroke" strokeWidth={1} color={color.ruleSoft} /> : null;
});

export function Chart(props: ChartProps) {
  const { type, candles, forming, lastPrice, precision, openTrades, nowSec, onNearLeftEdge } = props;
  const { labelFor = DEFAULT_LABEL, topInset = 0, hideReadout = false } = props;
  const { t } = useTranslation();
  const [manualRange, setManualRange] = useState<PriceRange | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewState>({ rightIndex: 0, visibleCount: DEFAULT_VISIBLE, following: true });
  const [crossX, setCrossX] = useState<number | null>(null);

  const closed = candles.length;
  const total = closed + (forming ? 1 : 0);
  const all = useMemo(() => (forming ? [...candles, forming] : candles), [candles, forming]);
  const plotW = Math.max(0, size.width - PRICE_AXIS);
  const height = size.height;
  const ready = plotW > 0 && height > 0;

  // The front of the list moved (older candles prepended, or the oldest trimmed at the retention cap): shift the
  // edge so a scrolled-back view keeps the same candles on screen. `indexShift` also carries the shift to a
  // gesture that is already in progress.
  const firstTs = candles[0]?.openTs ?? null;
  const [seen, setSeen] = useState(candles);
  const [indexShift, setIndexShift] = useState(0);
  if (frontChanged(seen, candles)) {
    setSeen(candles);
    const shift = firstCandleShift(seen, candles);
    if (shift !== 0) {
      setIndexShift((n) => n + shift);
      setView((v) =>
        v.following
          ? v
          : {
              ...v,
              rightIndex: shiftForPrepend({ width: 0, height: 0, rightIndex: v.rightIndex, visibleCount: v.visibleCount }, shift)
                .rightIndex,
            },
      );
    } else if (firstTs === null) {
      setView((v) => (v.following ? v : { ...v, following: true })); // history cleared (symbol change): back to live
    }
  }

  const rightIndex = view.following ? total : Math.min(view.rightIndex, rightLimit(total, view.visibleCount));
  const viewport: Viewport = { width: plotW, height, rightIndex, visibleCount: view.visibleCount };
  const { from, to } = visibleRange(viewport, total);
  const histTo = Math.min(to, closed);

  // The last price and forming candle only shape the range while the live edge is in view; scrolled far back,
  // they would squash the history you are looking at. The range follows ticks but is committed to the history
  // layer at most every 250ms; pan, zoom, resize and new candles commit straight away.
  const liveEdgeVisible = to >= total;
  const extras = [
    ...(liveEdgeVisible && lastPrice !== null ? [lastPrice] : []),
    ...openTrades.map((tr) => tr.entryPrice),
    ...(props.protection?.enabled ? [props.protection.stopLoss, props.protection.takeProfit].filter((p): p is number => p !== null) : []),
  ];
  const liveRange = manualRange ?? priceRange(all, from, to, extras);
  const range = useHistoryCommit(liveRange, [type, candles, from, histTo, plotW, height, rightIndex, view.visibleCount, manualRange]);

  // History layer: closed candles only, no last price.
  const history = useMemo(
    () => (ready ? buildSeries(type, candles, from, histTo, { width: plotW, height, rightIndex, visibleCount: view.visibleCount }, range) : EMPTY),
    [ready, type, candles, from, histTo, plotW, height, rightIndex, view.visibleCount, range],
  );

  // Live layer: the forming candle (line/area also keep the last closed point so the segment joins up).
  const liveFrom = type === "line" || type === "area" ? Math.max(from, closed - 1) : closed;
  const live = ready && forming !== null && to > closed ? buildSeries(type, all, liveFrom, total, viewport, range) : EMPTY;

  // Ask for older candles on entering the near-left zone (and again if a batch landed and we are still in it).
  const near = nearLeftEdge(viewport, total);
  const edge = useRef<EdgeState>({ near: false, firstTs: null });
  useEffect(() => {
    const next = { near, firstTs };
    if (shouldRequestOlder(edge.current, next)) onNearLeftEdge();
    edge.current = next;
  }, [near, firstTs, onNearLeftEdge]);

  const resetToLive = () => { setManualRange(null); setView(v => ({ ...v, following: true })); };
  const gesture = useChartGestures({
    priceRange: range,
    setPriceRange: setManualRange,
    viewport,
    total,
    indexShift,
    setViewport: (next) =>
      setView({ rightIndex: next.rightIndex, visibleCount: next.visibleCount, following: isFollowing(next.rightIndex, total) }),
    onCrosshair: setCrossX,
    onResetToLive: resetToLive,
  });

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  const fmt = (p: number) => fmtPrice(p, precision);
  const priceText = lastPrice !== null ? fmt(lastPrice) : "";
  const priceY = ready && lastPrice !== null ? yForPrice(lastPrice, range, height) : null;
  const soonest = selectedOpen(openTrades, props.selectedTradeId).selected;
  const expiryX = (tr: ChartTrade) => {
    const last = all[all.length - 1];
    if (!last) return null;
    const period = TIMEFRAME_SEC[props.timeframe ?? "1m"];
    const index = tr.expiryTs > last.openTs ? all.length - 1 + (tr.expiryTs - last.openTs) / period : entryIndex(all, tr.expiryTs);
    return xForIndex(index + 0.5, viewport);
  };

  const crossIndex = crossX !== null && crossX <= plotW ? Math.floor(indexForX(crossX, viewport)) : null;
  const crossCandle = crossIndex !== null && crossIndex >= 0 && crossIndex < total ? all[crossIndex] : undefined;
  const crossLineX = crossIndex !== null && crossCandle ? xForIndex(crossIndex + 0.5, viewport) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 }}>
        <View style={{ flex: 1 }}>{props.priceReadout ?? <FigText testID="displayed-price" text={priceText || "—"} size={18} weight={600} />}
          {soonest ? <Txt size={11} color={color.ink2}>{labelFor(soonest, nowSec)}</Txt> : null}
        </View>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {([{ id: "out", factor: 0.8, label: "−" }, { id: "in", factor: 1.25, label: "+" }] as const).map(control => <Pressable key={control.id} testID={`chart-zoom-${control.id}`} accessibilityRole="button" accessibilityLabel={t(control.id === "in" ? "trade.zoomIn" : "trade.zoomOut")} onPress={() => {
          setView(current => {
            const next = zoomAround({ ...viewport, rightIndex: current.following ? total : current.rightIndex, visibleCount: current.visibleCount }, plotW, control.factor, total);
            return { rightIndex: next.rightIndex, visibleCount: next.visibleCount, following: current.following };
          });
        }} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: color.surface, borderWidth: 1, borderColor: color.rule, borderRadius: radius.sm }}><Txt size={22}>{control.label}</Txt></Pressable>)}
      </View>

      </View>
      <View style={{ flex: 1 }} onLayout={onLayout}>
      <View testID="price-chart" style={{ flex: 1 }} accessible accessibilityLabel={t("trade.chartLabel")} accessibilityValue={{ text: t("trade.visibleCandles", { count: Math.round(view.visibleCount) }) }}>
        <GestureDetector gesture={gesture}>
          <View collapsable={false} style={{ flex: 1 }}>
          <Canvas style={{ flex: 1 }}>
            {ready ? (
              <>
                <Group clip={{ x: 0, y: 0, width: plotW, height }}>
                  <GridLayer plotW={plotW} height={height} />
                  <SeriesLayer type={type} series={history} height={height} />
                  <SeriesLayer type={type} series={live} height={height} />

                  {props.protection?.enabled ? [props.protection.stopLoss, props.protection.takeProfit].map((p, index) => p === null ? null : <Line key={index} p1={vec(0, yForPrice(p, range, height))} p2={vec(plotW, yForPrice(p, range, height))} color={index === 0 ? color.downText : color.up} strokeWidth={1}><DashPathEffect intervals={PRICE_DASH} /></Line>) : null}
                  {openTrades.map((tr) => {
                    const index = tr.mode === "OTC_FIXED" ? entryBucketIndex(all, tr.entryTs, TIMEFRAME_SEC[props.timeframe ?? "1m"]) : entryIndex(all, tr.entryTs);
                    if (index === null) return null;
                    const rawX = xForIndex(index + 0.5, viewport);
                    const tradeY = yForPrice(tr.entryPrice, range, height);
                    const ink = "#089981";
                    const endX = expiryX(tr);
                    const selected = tr.id === soonest?.id;
                    return <Group key={tr.id} opacity={selected ? 1 : 0.35}>
                      {endX !== null ? <Line p1={vec(endX, 0)} p2={vec(endX, height)} color={selected ? color.ink : color.ink3} strokeWidth={1}><DashPathEffect intervals={PRICE_DASH} /></Line> : null}
                      <Line p1={vec(selected ? 0 : Math.max(0, rawX), tradeY)} p2={vec(plotW, tradeY)} color={ink} strokeWidth={1} />
                      {rawX >= 0 ? <Circle cx={rawX} cy={tradeY} r={3} color={ink} /> : null}
                      {(["stopLoss", "takeProfit"] as const).map(side => {
                        const level = tr[side];
                        return level == null ? null : <Line key={side} p1={vec(Math.max(0, rawX), yForPrice(level, range, height))} p2={vec(plotW, yForPrice(level, range, height))} color={side === "stopLoss" ? "#f23645" : "#089981"} strokeWidth={1}><DashPathEffect intervals={PRICE_DASH} /></Line>;
                      })}
                    </Group>;
                  })}

                  {priceY !== null ? (
                    <Line p1={vec(0, priceY)} p2={vec(plotW, priceY)} color={color.ink3} strokeWidth={1}>
                      <DashPathEffect intervals={PRICE_DASH} />
                    </Line>
                  ) : null}
                  {crossLineX !== null ? (
                    <Line p1={vec(crossLineX, 0)} p2={vec(crossLineX, height)} color={color.ink2} strokeWidth={1} />
                  ) : null}
                </Group>
              </>
            ) : null}
          </Canvas>
          </View>
        </GestureDetector>
      </View>

      {ready ? <View pointerEvents="none" style={{ position: "absolute", inset: 0 }}>
        {priceY !== null && priceY >= 8 && priceY <= height - 8 ? <View style={{ position: "absolute", left: 12, top: priceY - 8, backgroundColor: color.ground, paddingHorizontal: 4 }}><Txt size={10} color={color.ink2}>{t("trade.currentPrice")}</Txt></View> : null}
        {soonest && yForPrice(soonest.entryPrice, range, height) >= 8 && yForPrice(soonest.entryPrice, range, height) <= height - 8 ? <View style={{ position: "absolute", left: priceY !== null && Math.abs(priceY - yForPrice(soonest.entryPrice, range, height)) < 18 ? 110 : 32, top: yForPrice(soonest.entryPrice, range, height) - 8, backgroundColor: color.ground, paddingHorizontal: 4 }}><Txt size={10} color="#089981">{t("trade.entryPrice")}</Txt></View> : null}
        {soonest && expiryX(soonest) !== null && expiryX(soonest)! >= 0 && expiryX(soonest)! <= plotW ? <View style={{ position: "absolute", left: Math.max(0, Math.min(plotW - 100, expiryX(soonest)! - 50)), top: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: color.raised }}><Txt size={10}>{t("trade.expiryEnd")} · {labelFor(soonest, nowSec)}</Txt></View> : null}
      </View> : null}
      {ready && props.protection?.enabled && props.onProtectionPrice ? (["stopLoss", "takeProfit"] as const).map(side => {
        const price = props.protection![side];
        return price === null ? null : <ProtectionHandle key={side} label={side === "stopLoss" ? "SL" : "TP"} price={price} range={range} height={height} axis={PRICE_AXIS} precision={precision} onPrice={price => props.onProtectionPrice!(side, price)} />;
      }) : null}
      {crossCandle && showReadout({ hide: hideReadout, hasCandle: true }) ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            ...readoutBox(topInset, PRICE_AXIS),
            backgroundColor: color.surface,
            borderWidth: 1,
            borderColor: color.rule,
            borderRadius: radius.sm,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <FigText
            size={11}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            text={`${t("trade.ohlcO")} ${fmt(crossCandle.o)}  ${t("trade.ohlcH")} ${fmt(crossCandle.h)}  ${t("trade.ohlcL")} ${fmt(crossCandle.l)}  ${t("trade.ohlcC")} ${fmt(crossCandle.c)}`}
          />
        </View>
      ) : null}

      {!view.following || manualRange !== null ? (
        <Pressable
          accessibilityRole="button"
          testID="chart-reset"
          accessibilityLabel={t("trade.backToLive")}
          onPress={resetToLive}
          hitSlop={8}
          style={{
            position: "absolute",
            right: PRICE_AXIS + 8,
            bottom: 8,
            minHeight: 44,
            minWidth: 44,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: color.accentText,
            borderRadius: radius.pill,
            paddingHorizontal: 16,
          }}
        >
          <Txt weight={600} size={14} color={color.ground}>
            {t("trade.backToLive")} →
          </Txt>
        </Pressable>
      ) : null}
      </View>
    </View>
  );
}
