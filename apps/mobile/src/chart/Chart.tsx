import { AnekDevanagari_600SemiBold } from "@expo-google-fonts/anek-devanagari/600SemiBold";
import { AnekLatin_600SemiBold } from "@expo-google-fonts/anek-latin/600SemiBold";
import { MartianMono_600SemiBold } from "@expo-google-fonts/martian-mono/600SemiBold";
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  LinearGradient,
  Line,
  Path,
  RoundedRect,
  Skia,
  Text as SkText,
  type SkFont,
  matchFont,
  useFont,
  vec,
} from "@shopify/react-native-skia";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { shortCountdown } from "@asm/client-core";
import type { CandleDto, TradeView } from "@asm/contracts";
import { scriptFor } from "@/theme/font-families";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { FigText } from "@/ui/FigText";
import { firstCandleShift, frontChanged, isFollowing, shouldRequestOlder, type EdgeState } from "./live";
import { fmtPrice } from "./format-price";
import { buildSeries, type SeriesPaths } from "./paths";
import { indexForX, nearLeftEdge, priceRange, shiftForPrepend, visibleRange, xForIndex, yForPrice } from "./scale";
import { entryIndex, gridYs, hasNonAscii, priceTagRect, readoutBox, showReadout, tradeTagRect } from "./tag-layout";
import type { ChartType, Viewport } from "./types";
import { useChartGestures } from "./useChartGestures";
import { useHistoryCommit } from "./useHistoryCommit";

const PRICE_AXIS = 56;
const DEFAULT_VISIBLE = 60;
const EMPTY: SeriesPaths = { up: "", down: "" };
/** Dash pattern of the last-price line (hoisted: a fresh array per render would re-create the effect). */
const PRICE_DASH = [4, 3];

/** What the chart needs of an open trade. */
export type ChartTrade = TradeView;
const DEFAULT_LABEL = (tr: ChartTrade, nowSec: number) => shortCountdown(Math.max(0, tr.expiryTs - nowSec));

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
        {up ? <Path path={up} style="stroke" strokeWidth={1.5} color={color.up} /> : null}
        {down ? <Path path={down} style="stroke" strokeWidth={1.5} color={color.downText} /> : null}
      </>
    );
  }
  // Candles: bodies filled (a wick has no area, so it does not paint), wicks stroked separately.
  return (
    <>
      {up ? <Path path={up} style="fill" color={color.up} /> : null}
      {down ? <Path path={down} style="fill" color={color.downText} /> : null}
      {upWicks ? <Path path={upWicks} style="stroke" strokeWidth={1} color={color.up} /> : null}
      {downWicks ? <Path path={downWicks} style="stroke" strokeWidth={1} color={color.downText} /> : null}
    </>
  );
});

/** Three faint horizontal rules under the candles. One path, parsed once per size. */
const GridLayer = memo(function GridLayer({ plotW, height }: { plotW: number; height: number }) {
  const d = useMemo(() => gridYs(height).map((y) => `M0 ${Math.round(y) + 0.5} H${plotW}`).join(" "), [plotW, height]);
  const grid = useSkPath(d);
  return grid ? <Path path={grid} style="stroke" strokeWidth={1} color={color.ruleSoft} /> : null;
});

/**
 * An open trade: an accent line from the entry candle to the right edge ending in a dot at the entry, and a tag
 * "Down 0:08" (or "Down Settling…") sized by measuring its text. The width is memoised on font and text, so it is
 * measured only when either changes, not on every price tick.
 */
const TradeLine = memo(function TradeLine({
  side,
  label,
  x,
  y,
  plotW,
  figFont,
  uiFont,
}: {
  side: string;
  label: string;
  x: number;
  y: number;
  plotW: number;
  /** Martian Mono: for pure-ASCII tag text. */
  figFont: SkFont;
  /** Anek: for tag text with Hindi words or the ellipsis, which Martian has no glyphs for. */
  uiFont: SkFont;
}) {
  const text = `${side} ${label}`;
  const font = hasNonAscii(text) ? uiFont : figFont;
  const textW = useMemo(() => font.measureText(text).width, [font, text]);
  const tag = tradeTagRect(plotW, textW);
  return (
    <Group>
      <Line p1={vec(x, y)} p2={vec(plotW, y)} color={color.accent} strokeWidth={1.5} />
      <Circle cx={x} cy={y} r={4} color={color.accent} />
      <RoundedRect x={tag.x} y={y - 11} width={tag.w} height={22} r={4} color={color.accent} />
      <SkText x={tag.textX} y={y + 4} text={text} font={font} color={color.onAccent} />
    </Group>
  );
});

/** The last-price tag: ink-white with dark text, hanging from the axis side, sized to its text (it may overlap the plot). */
const PriceTag = memo(function PriceTag({
  y,
  plotW,
  text,
  textW,
  font,
}: {
  y: number;
  plotW: number;
  text: string;
  textW: number;
  font: SkFont;
}) {
  const tag = priceTagRect(plotW, PRICE_AXIS, textW);
  return (
    <Group>
      <RoundedRect x={tag.x} y={y - 11} width={tag.w} height={22} r={4} color={color.ink} />
      <SkText x={tag.textX} y={y + 4} text={text} font={font} color={color.ground} />
    </Group>
  );
});

export function Chart(props: ChartProps) {
  const { type, candles, forming, lastPrice, precision, openTrades, nowSec, onNearLeftEdge } = props;
  const { labelFor = DEFAULT_LABEL, topInset = 0, hideReadout = false } = props;
  const { t, i18n } = useTranslation();
  const fallbackFont = useMemo(() => matchFont({ fontFamily: "sans-serif", fontSize: 11 }), []);
  // Martian Mono (bundled) for prices on the canvas; the system font until it has loaded.
  const figFont = useFont(MartianMono_600SemiBold, 11) ?? fallbackFont;
  // Anek (bundled) for tag text Martian cannot draw (Hindi words, "…"). Skia draws unshaped, so conjuncts may be plain.
  const uiFont = useFont(scriptFor(i18n.language) === "devanagari" ? AnekDevanagari_600SemiBold : AnekLatin_600SemiBold, 11) ?? fallbackFont;

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

  const fmt = (p: number) => fmtPrice(p, precision);
  const priceText = lastPrice !== null ? fmt(lastPrice) : "";
  const priceTextW = useMemo(() => figFont.measureText(priceText).width, [figFont, priceText]);
  const clampY = (y: number) => Math.min(height - 2, Math.max(12, y));
  const priceY = ready && lastPrice !== null ? Math.min(height - 11, Math.max(11, yForPrice(lastPrice, range, height))) : null;

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
                  <GridLayer plotW={plotW} height={height} />
                  <SeriesLayer type={type} series={history} height={height} />
                  <SeriesLayer type={type} series={live} height={height} />

                  {openTrades.map((tr) => (
                    <TradeLine
                      key={tr.id}
                      side={tr.direction === "UP" ? t("trade.up") : t("trade.down")}
                      label={labelFor(tr, nowSec)}
                      x={Math.max(0, xForIndex(entryIndex(all, tr.entryTs) + 0.5, viewport))}
                      y={clampY(yForPrice(tr.entryPrice, range, height))}
                      plotW={plotW}
                      figFont={figFont}
                      uiFont={uiFont}
                    />
                  ))}

                  {priceY !== null ? (
                    <Line p1={vec(0, priceY)} p2={vec(plotW, priceY)} color={color.ink3} strokeWidth={1}>
                      <DashPathEffect intervals={PRICE_DASH} />
                    </Line>
                  ) : null}
                  {crossLineX !== null ? (
                    <Line p1={vec(crossLineX, 0)} p2={vec(crossLineX, height)} color={color.ink2} strokeWidth={1} />
                  ) : null}
                </Group>

                {priceY !== null && lastPrice !== null ? (
                  <PriceTag y={priceY} plotW={plotW} text={priceText} textW={priceTextW} font={figFont} />
                ) : null}
              </>
            ) : null}
          </Canvas>
        </GestureDetector>
      </View>

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

      {!view.following ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("trade.backToLive")}
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
            backgroundColor: color.accent,
            borderRadius: radius.pill,
            paddingHorizontal: 16,
          }}
        >
          <Txt weight={600} size={14} color={color.onAccent}>
            {t("trade.backToLive")} ›
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
