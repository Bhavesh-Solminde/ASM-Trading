import { useLayoutEffect, useMemo, useRef } from "react";
import { Gesture } from "react-native-gesture-handler";
import { startViewport } from "./live";
import { panBy, zoomAround } from "./scale";
import type { Viewport } from "./types";

export interface ChartGestureOpts {
  /** The viewport as currently drawn. Read when a gesture starts, never captured in a closure. */
  viewport: Viewport;
  total: number;
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
 * Pan, pinch-zoom, long-press crosshair and double-tap-to-live. Built once: the handlers read the latest
 * options and the gesture's start viewport from refs, so a re-render mid-gesture neither rebuilds the
 * recognisers (which would drop the touch) nor reads a stale viewport. `runOnJS(true)` keeps the
 * handlers on the JS thread, so they are plain functions and no worklets are involved.
 */
export function useChartGestures(opts: ChartGestureOpts) {
  const latest = useRef(opts);
  const start = useRef({ viewport: opts.viewport, shift: opts.indexShift });
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
      .onStart(() => {
        start.current = { viewport: latest.current.viewport, shift: latest.current.indexShift };
      })
      .onUpdate((e) => {
        const { total, setViewport } = latest.current;
        setViewport(panBy(startNow(), e.translationX, total));
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

    // Pan that only activates after a 250ms hold; moving earlier fails it so the plain pan above takes over.
    const crosshair = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .activateAfterLongPress(250)
      .onStart((e) => latest.current.onCrosshair(e.x))
      .onUpdate((e) => latest.current.onCrosshair(e.x))
      .onFinalize(() => latest.current.onCrosshair(null));

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd((_e, success) => {
        if (success) latest.current.onResetToLive();
      });

    return Gesture.Race(Gesture.Simultaneous(Gesture.Exclusive(crosshair, pan), pinch), doubleTap);
  }, []);
}
