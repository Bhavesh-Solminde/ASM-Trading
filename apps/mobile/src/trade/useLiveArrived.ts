import { useEffect, useState } from "react";
import { useSocket } from "@/socket/socket-store";

/**
 * True once live candles have shown up, and for the rest of this mount. Gates the stale resume snapshot:
 * after live data has arrived the snapshot is never painted or labelled again, even on a market switch.
 */
export function useLiveArrived(): boolean {
  const has = useSocket((s) => s.chart.candles.length > 0);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (has) setArrived(true);
  }, [has]);
  return arrived || has;
}
