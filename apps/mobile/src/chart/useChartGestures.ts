import { useLayoutEffect, useMemo, useRef } from "react";
import { Gesture, MouseButton } from "react-native-gesture-handler";
import { startViewport } from "./live";
import { panBy, panPriceRange, zoomAround } from "./scale";
import type { PriceRange, Viewport } from "./types";

export interface ChartGestureOpts {
  /** The viewport as currently drawn. Read when a gesture starts, never captured in a closure. */
  viewport: Viewport;
  total: number;
  priceRange: PriceRange;
  setPriceRange: (range: PriceRange) => void;
  /**
   * Cumulative index shift from candles prepended to / trimmed from the front. A gesture's start
   * viewport is moved by what landed since it began, so a backfill mid-pan does not make the view jump.
   */
  indexShift: number;
  setViewport: (vp: Viewport) => void;
  onCrosshair: (x: number | null) => void;
  /** Double tap: back to the live edge. */
  onResetToLive: () => void;
}

/**
 * Two-axis pan, pinch zoom, stationary crosshair and double-tap-to-live. Built once: the handlers read the latest
 * options and the gesture's start viewport from refs, so a re-render mid-gesture neither rebuilds the
 * recognisers (which would drop the touch) nor reads a stale viewport. `runOnJS(true)` keeps the
 * handlers on the JS thread, so they are plain functions and no worklets are involved.
 */
export function useChartGestures(opts: ChartGestureOpts) {
  const latest = useRef(opts);
  const start = useRef({ viewport: opts.viewport, shift: opts.indexShift });
  const dragRange = useRef(opts.priceRange);
  // Layout effect: runs in the commit itself, so no gesture event can see a stale shift or viewport.
  useLayoutEffect(() => {
    latest.current = opts;
  });
  const startNow = () => {
    const { viewport, shift } = start.current;
    return startViewport(viewport, shift, latest.current.indexShift);
  };

  return useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(4)
      .mouseButton(MouseButton.LEFT)
      .onStart(() => {
        start.current = { viewport: latest.current.viewport, shift: latest.current.indexShift };
        dragRange.current = latest.current.priceRange;
      })
      .onUpdate((e) => {
        const { total, setViewport, setPriceRange } = latest.current;
        const initial = startNow();
        setViewport(panBy(initial, e.translationX, total));
        setPriceRange(panPriceRange(dragRange.current, e.translationY, initial.height));
      });

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        start.current = { viewport: latest.current.viewport, shift: latest.current.indexShift };
      })
      .onUpdate((e) => {
        const { total, setViewport } = latest.current;
        setViewport(zoomAround(startNow(), e.focalX, e.scale, total));
      });

    // A stationary hold shows OHLC; it must never take ownership of a later drag.
    const crosshair = Gesture.LongPress()
      .runOnJS(true)
      .minDuration(350)
      .maxDistance(4)
      .onStart((e) => latest.current.onCrosshair(e.x))
      .onFinalize(() => latest.current.onCrosshair(null));

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd((_e, success) => {
        if (success) latest.current.onResetToLive();
      });

    return Gesture.Race(Gesture.Simultaneous(pan, pinch, crosshair), doubleTap);
  }, []);
}
