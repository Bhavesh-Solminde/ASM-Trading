import {
  Canvas,
  Group,
  LinearGradient,
  Line,
  Path,
  Rect,
  Skia,
  Text as SkText,
  type SkFont,
  matchFont,
  vec,
} from "@shopify/react-native-skia";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { shortCountdown } from "@asm/client-core";
import type { CandleDto, TradeView } from "@asm/contracts";
import { color } from "@/theme/tokens";
import { firstCandleShift, isFollowing, shouldRequestOlder, type EdgeState } from "./live";
import { buildSeries, type SeriesPaths } from "./paths";
import { indexForX, nearLeftEdge, priceRange, shiftForPrepend, visibleRange, xForIndex, yForPrice } from "./scale";
import type { ChartType, Viewport } from "./types";
import { useChartGestures } from "./useChartGestures";
import { useHistoryCommit } from "./useHistoryCommit";

const PRICE_AXIS = 56;
const DEFAULT_VISIBLE = 60;
const EMPTY: SeriesPaths = { up: "", down: "" };

export interface ChartProps {
  type: ChartType;
  /** Closed candles, oldest first. */
  candles: CandleDto[];
  forming: CandleDto | null;
  lastPrice: number | null;
  precision: number;
  openTrades: TradeView[];
  /** Epoch seconds, for the open-trade countdowns. */
  nowSec: number;
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
            <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[`${color.brand}66`, `${color.brand}00`]} />
          </Path>
        ) : null}
        {line ? <Path path={line} style="stroke" strokeWidth={1.5} strokeJoin="round" color={color.brand} /> : null}
      </>
    );
  }
  if (type === "bars") {
    return (
      <>
        {up ? <Path path={up} style="stroke" strokeWidth={1.5} color={color.up} /> : null}
        {down ? <Path path={down} style="stroke" strokeWidth={1.5} color={color.down} /> : null}
      </>
    );
  }
  // Candles: bodies filled (a wick has no area, so it does not paint), wicks stroked separately.
  return (
    <>
      {up ? <Path path={up} style="fill" color={color.up} /> : null}
      {down ? <Path path={down} style="fill" color={color.down} /> : null}
      {upWicks ? <Path path={upWicks} style="stroke" strokeWidth={1} color={color.up} /> : null}
      {downWicks ? <Path path={downWicks} style="stroke" strokeWidth={1} color={color.down} /> : null}
    </>
  );
});

/** An open trade's entry line, direction triangle and countdown. The triangle path is parsed once per position. */
function TradeLine({
  direction,
  y,
  plotW,
  label,
  font,
}: {
  direction: TradeView["direction"];
  y: number;
  plotW: number;
  label: string;
  font: SkFont;
}) {
  const tone = direction === "UP" ? color.up : color.down;
  const tri = useSkPath(
    direction === "UP" ? `M6 ${y - 4} L14 ${y - 4} L10 ${y - 11} Z` : `M6 ${y - 11} L14 ${y - 11} L10 ${y - 4} Z`,
  );
  return (
    <Group>
      <Line p1={vec(0, y)} p2={vec(plotW, y)} color={tone} strokeWidth={1} />
      {tri ? <Path path={tri} color={tone} /> : null}
      <SkText x={18} y={y - 4} text={label} font={font} color={tone} />
    </Group>
  );
}

export function Chart(props: ChartProps) {
  const { type, candles, forming, lastPrice, precision, openTrades, nowSec, onNearLeftEdge } = props;
  const { t } = useTranslation();
  const font = useMemo(() => matchFont({ fontFamily: "sans-serif", fontSize: 11 }), []);

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
  if (seen[0]?.openTs !== firstTs) {
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

  const rightIndex = view.following ? total : Math.min(view.rightIndex, total);
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
  ];
  const liveRange = priceRange(all, from, to, extras);
  const range = useHistoryCommit(liveRange, [type, candles, from, histTo, plotW, height, rightIndex, view.visibleCount]);

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

  const gesture = useChartGestures({
    viewport,
    total,
    indexShift,
    setViewport: (next) =>
      setView({ rightIndex: next.rightIndex, visibleCount: next.visibleCount, following: isFollowing(next.rightIndex, total) }),
    onCrosshair: setCrossX,
    onResetToLive: () => setView((v) => ({ ...v, following: true })),
  });

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  const fmt = (p: number) => p.toFixed(precision);
  const clampY = (y: number) => Math.min(height - 2, Math.max(12, y));
  const priceY = ready && lastPrice !== null ? Math.min(height - 9, Math.max(9, yForPrice(lastPrice, range, height))) : null;

  const crossIndex = crossX !== null && crossX <= plotW ? Math.floor(indexForX(crossX, viewport)) : null;
  const crossCandle = crossIndex !== null && crossIndex >= 0 && crossIndex < total ? all[crossIndex] : undefined;
  const crossLineX = crossIndex !== null && crossCandle ? xForIndex(crossIndex + 0.5, viewport) : null;

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <View style={{ flex: 1 }} accessible accessibilityLabel={t("trade.chartLabel")}>
        <GestureDetector gesture={gesture}>
          <Canvas style={{ flex: 1 }}>
            {ready ? (
              <>
                <Group clip={{ x: 0, y: 0, width: plotW, height }}>
                  <SeriesLayer type={type} series={history} height={height} />
                  <SeriesLayer type={type} series={live} height={height} />

                  {openTrades.map((tr) => (
                    <TradeLine
                      key={tr.id}
                      direction={tr.direction}
                      y={clampY(yForPrice(tr.entryPrice, range, height))}
                      plotW={plotW}
                      label={shortCountdown(Math.max(0, tr.expiryTs - nowSec))}
                      font={font}
                    />
                  ))}

                  {priceY !== null ? <Line p1={vec(0, priceY)} p2={vec(plotW, priceY)} color={color.brand} strokeWidth={1} /> : null}
                  {crossLineX !== null ? (
                    <Line p1={vec(crossLineX, 0)} p2={vec(crossLineX, height)} color={color.ink2} strokeWidth={1} />
                  ) : null}
                </Group>

                {priceY !== null && lastPrice !== null ? (
                  <Group>
                    <Rect x={plotW} y={priceY - 9} width={PRICE_AXIS} height={18} color={color.brand} />
                    <SkText x={plotW + 4} y={priceY + 4} text={fmt(lastPrice)} font={font} color={color.brandInk} />
                  </Group>
                ) : null}
              </>
            ) : null}
          </Canvas>
        </GestureDetector>
      </View>

      {crossCandle ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 6, left: 6, backgroundColor: color.panel, borderRadius: 8, padding: 6 }}
        >
          <Text style={{ color: color.ink, fontSize: 11, fontVariant: ["tabular-nums"] }}>
            {t("trade.ohlcO")} {fmt(crossCandle.o)}  {t("trade.ohlcH")} {fmt(crossCandle.h)}  {t("trade.ohlcL")}{" "}
            {fmt(crossCandle.l)}  {t("trade.ohlcC")} {fmt(crossCandle.c)}
          </Text>
        </View>
      ) : null}

      {!view.following ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setView((v) => ({ ...v, following: true }))}
          hitSlop={8}
          style={{
            position: "absolute",
            right: PRICE_AXIS + 8,
            bottom: 8,
            minHeight: 44,
            minWidth: 44,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: color.brandFill,
            borderRadius: 999,
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ color: color.brandInk, fontWeight: "700" }}>{t("trade.backToLive")} ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
