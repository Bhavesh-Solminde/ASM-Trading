import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from "lightweight-charts";

export interface HlcAreaData extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HlcAreaSeriesOptions extends CustomSeriesOptions {
  highLineColor: string;
  highLineWidth: number;
  highFillColor: string;
  lowLineColor: string;
  lowLineWidth: number;
  lowFillColor: string;
  closeLineColor: string;
  closeLineWidth: number;
}

interface TargetScope {
  context: CanvasRenderingContext2D;
}

interface CanvasTarget {
  useMediaCoordinateSpace<T>(f: (scope: TargetScope) => T): T;
}

interface RenderPoint {
  x: number;
  yHigh: number;
  yLow: number;
  yClose: number;
}

export class HlcAreaPaneRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, HlcAreaData> | null = null;
  private _options: HlcAreaSeriesOptions | null = null;

  update(data: PaneRendererCustomData<Time, HlcAreaData>, options: HlcAreaSeriesOptions): void {
    this._data = data;
    this._options = options;
  }

  draw(target: CanvasTarget, priceConverter: PriceToCoordinateConverter): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      if (!this._data || !this._options || this._data.bars.length === 0) return;
      const bars = this._data.bars;
      const visibleRange = this._data.visibleRange;
      if (!visibleRange) return;

      // Expand visible range by 1 bar on each side so the curves and shaded regions
      // run seamlessly to the edges of the canvas without clipping or jagged cuts.
      const from = Math.max(0, visibleRange.from - 1);
      const to = Math.min(bars.length - 1, visibleRange.to + 1);
      if (from > to) return;

      const points: RenderPoint[] = [];

      for (let i = from; i <= to; i++) {
        const b = bars[i];
        if (!b || !b.originalData || b.originalData.close === undefined) continue;

        // In financial data: Low <= Close <= High
        const rawHigh = b.originalData.high;
        const rawLow = b.originalData.low;
        const rawClose = b.originalData.close;

        const high = Math.max(rawHigh, rawLow, rawClose);
        const low = Math.min(rawHigh, rawLow, rawClose);
        const close = Math.max(low, Math.min(high, rawClose));

        const yHigh = priceConverter(high);
        const yLow = priceConverter(low);
        const yClose = priceConverter(close);

        if (yHigh === null || yLow === null || yClose === null) continue;

        // Canvas Y coordinates: higher price = smaller Y
        // Screen bounds guarantee yHigh <= yClose <= yLow
        const screenHigh = Math.min(yHigh, yLow, yClose);
        const screenLow = Math.max(yHigh, yLow, yClose);
        const screenClose = Math.max(screenHigh, Math.min(screenLow, yClose));

        points.push({
          x: b.x,
          yHigh: screenHigh,
          yLow: screenLow,
          yClose: screenClose,
        });
      }

      if (points.length < 2) return;

      const opts = this._options;

      // 1. Upper Shaded Area (between High line and Close line)
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const pt = points[i]!;
        if (i === 0) ctx.moveTo(pt.x, pt.yHigh);
        else ctx.lineTo(pt.x, pt.yHigh);
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const pt = points[i]!;
        ctx.lineTo(pt.x, pt.yClose);
      }
      ctx.closePath();
      ctx.fillStyle = opts.highFillColor;
      ctx.fill();

      // 2. Lower Shaded Area (between Close line and Low line)
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const pt = points[i]!;
        if (i === 0) ctx.moveTo(pt.x, pt.yClose);
        else ctx.lineTo(pt.x, pt.yClose);
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const pt = points[i]!;
        ctx.lineTo(pt.x, pt.yLow);
      }
      ctx.closePath();
      ctx.fillStyle = opts.lowFillColor;
      ctx.fill();

      // Setup smooth continuous stroke settings
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // 3. High Price Curve (Top boundary line in emerald teal)
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const pt = points[i]!;
        if (i === 0) ctx.moveTo(pt.x, pt.yHigh);
        else ctx.lineTo(pt.x, pt.yHigh);
      }
      ctx.strokeStyle = opts.highLineColor;
      ctx.lineWidth = opts.highLineWidth;
      ctx.stroke();

      // 4. Low Price Curve (Bottom boundary line in coral red)
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const pt = points[i]!;
        if (i === 0) ctx.moveTo(pt.x, pt.yLow);
        else ctx.lineTo(pt.x, pt.yLow);
      }
      ctx.strokeStyle = opts.lowLineColor;
      ctx.lineWidth = opts.lowLineWidth;
      ctx.stroke();

      // 5. Close Price Curve (Center dividing curve)
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const pt = points[i]!;
        if (i === 0) ctx.moveTo(pt.x, pt.yClose);
        else ctx.lineTo(pt.x, pt.yClose);
      }
      ctx.strokeStyle = opts.closeLineColor;
      ctx.lineWidth = opts.closeLineWidth;
      ctx.stroke();
    });
  }
}

export class HlcAreaSeriesView
  implements ICustomSeriesPaneView<Time, HlcAreaData, HlcAreaSeriesOptions>
{
  private _renderer = new HlcAreaPaneRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(data: PaneRendererCustomData<Time, HlcAreaData>, options: HlcAreaSeriesOptions): void {
    this._renderer.update(data, options);
  }

  priceValueBuilder(plotRow: HlcAreaData): CustomSeriesPricePlotValues {
    return [plotRow.low, plotRow.high, plotRow.close];
  }

  isWhitespace(
    data: HlcAreaData | CustomSeriesWhitespaceData<Time>,
  ): data is CustomSeriesWhitespaceData<Time> {
    return (data as HlcAreaData).close === undefined;
  }

  defaultOptions(): HlcAreaSeriesOptions {
    return {
      ...customSeriesDefaultOptions,
      highLineColor: "#089981",
      highLineWidth: 1.5,
      highFillColor: "rgba(8, 153, 129, 0.20)",
      lowLineColor: "#f23645",
      lowLineWidth: 1.5,
      lowFillColor: "rgba(242, 54, 69, 0.20)",
      closeLineColor: "#cbd5e1",
      closeLineWidth: 2,
    };
  }
}
