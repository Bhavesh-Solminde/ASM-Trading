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

export interface VolumeCandleData extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface VolumeCandlesSeriesOptions extends CustomSeriesOptions {
  upColor: string;
  downColor: string;
  wickUpColor: string;
  wickDownColor: string;
}

interface TargetScope {
  context: CanvasRenderingContext2D;
}

interface CanvasTarget {
  useMediaCoordinateSpace<T>(f: (scope: TargetScope) => T): T;
}

export class VolumeCandlesPaneRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, VolumeCandleData> | null = null;
  private _options: VolumeCandlesSeriesOptions | null = null;

  update(
    data: PaneRendererCustomData<Time, VolumeCandleData>,
    options: VolumeCandlesSeriesOptions,
  ): void {
    this._data = data;
    this._options = options;
  }

  draw(target: CanvasTarget, priceConverter: PriceToCoordinateConverter): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      if (!this._data || !this._options || this._data.bars.length === 0) return;
      const bars = this._data.bars;
      const visibleRange = this._data.visibleRange;
      const from = visibleRange ? Math.max(0, visibleRange.from) : 0;
      const to = visibleRange ? Math.min(bars.length - 1, visibleRange.to) : bars.length - 1;
      if (from > to) return;

      const baseSpacing = Math.max(2, this._data.barSpacing || 6);

      // Compute average volume / range across visible bars to normalize candle width
      let totalWeight = 0;
      let count = 0;
      for (let i = from; i <= to; i++) {
        const d = bars[i]!.originalData;
        const weight = d.volume ?? Math.max(1, (d.high - d.low) + (d.open * 0.0001));
        totalWeight += weight;
        count++;
      }
      const avgWeight = count > 0 ? totalWeight / count : 1;

      // Draw each volume candle
      for (let i = from; i <= to; i++) {
        const b = bars[i]!;
        const d = b.originalData;
        const yOpen = priceConverter(d.open);
        const yClose = priceConverter(d.close);
        const yHigh = priceConverter(d.high);
        const yLow = priceConverter(d.low);
        if (yOpen === null || yClose === null || yHigh === null || yLow === null) continue;

        const isUp = d.close >= d.open;
        const bodyColor = isUp ? this._options.upColor : this._options.downColor;
        const wickColor = isUp ? this._options.wickUpColor : this._options.wickDownColor;

        // Scale candle width proportionally to volume/range (bounded between 0.35x and 2.5x base width)
        const weight = d.volume ?? Math.max(1, (d.high - d.low) + (d.open * 0.0001));
        const factor = Math.max(0.35, Math.min(2.5, weight / avgWeight));
        const candleWidth = Math.max(2, Math.round(baseSpacing * 0.8 * factor));

        // 1. Draw Wicks
        ctx.strokeStyle = wickColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(b.x), Math.round(yHigh));
        ctx.lineTo(Math.round(b.x), Math.round(yLow));
        ctx.stroke();

        // 2. Draw Body
        const top = Math.round(Math.min(yOpen, yClose));
        const height = Math.max(1, Math.round(Math.abs(yClose - yOpen)));
        const left = Math.round(b.x - candleWidth / 2);

        ctx.fillStyle = bodyColor;
        ctx.fillRect(left, top, candleWidth, height);
      }
    });
  }
}

export class VolumeCandlesSeriesView
  implements ICustomSeriesPaneView<Time, VolumeCandleData, VolumeCandlesSeriesOptions>
{
  private _renderer = new VolumeCandlesPaneRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(
    data: PaneRendererCustomData<Time, VolumeCandleData>,
    options: VolumeCandlesSeriesOptions,
  ): void {
    this._renderer.update(data, options);
  }

  priceValueBuilder(plotRow: VolumeCandleData): CustomSeriesPricePlotValues {
    return [plotRow.low, plotRow.high, plotRow.close];
  }

  isWhitespace(
    data: VolumeCandleData | CustomSeriesWhitespaceData<Time>,
  ): data is CustomSeriesWhitespaceData<Time> {
    return (data as VolumeCandleData).close === undefined;
  }

  defaultOptions(): VolumeCandlesSeriesOptions {
    return {
      ...customSeriesDefaultOptions,
      upColor: "#3be584",
      downColor: "#e5413b",
      wickUpColor: "#3be584",
      wickDownColor: "#e5413b",
    };
  }
}
