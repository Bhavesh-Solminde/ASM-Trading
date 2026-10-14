import { useEffect, useMemo, useRef } from "react";
import { Gesture } from "react-native-gesture-handler";
import { panBy, zoomAround } from "./scale";
import type { Viewport } from "./types";

export interface ChartGestureOpts {
  /** The viewport as currently drawn. Read when a gesture starts, never captured in a closure. */
  viewport: Viewport;
  total: number;
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
  const start = useRef(opts.viewport);
  useEffect(() => {
    latest.current = opts;
  });

  return useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(4)
      .onStart(() => {
        start.current = latest.current.viewport;
      })
      .onUpdate((e) => {
        const { total, setViewport } = latest.current;
        setViewport(panBy(start.current, e.translationX, total));
      });

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        start.current = latest.current.viewport;
      })
      .onUpdate((e) => {
        const { total, setViewport } = latest.current;
        setViewport(zoomAround(start.current, e.focalX, e.scale, total));
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
