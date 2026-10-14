import { useEffect } from "react";
import { AppState } from "react-native";
import type { Timeframe } from "@asm/contracts";
import { useSession } from "@/auth/session-store";
import { resumeSaver } from "@/cache/resume-cache";
import { buildResumeSnapshot } from "@/cache/snapshot";
import { useSocket } from "@/socket/socket-store";

/**
 * Keeps the resume cache fresh: a throttled save (one per 5s at most) whenever candles or trades change,
 * and an immediate one when the app goes to the background. The snapshot is built when the save fires and
 * only while a session token exists, so a sign-out can never be followed by a write; the pending save is
 * also dropped on unmount and by `clearResume`.
 */
export function useResumeSave(userId: string | null, accountId: string | null, symbol: string | null, timeframe: Timeframe) {
  useEffect(() => {
    if (!userId || !accountId || !symbol) return;
    const build = () => {
      const s = useSocket.getState();
      return buildResumeSnapshot({
        userId,
        accountId,
        symbol,
        timeframe,
        chart: s.chart,
        trades: s.trades,
        signedIn: useSession.getState().token !== null,
        now: Date.now(),
      });
    };
    resumeSaver.schedule(build);
    const unsubscribe = useSocket.subscribe((s, prev) => {
      if (s.chart.candles !== prev.chart.candles || s.trades !== prev.trades) resumeSaver.schedule(build);
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "background") resumeSaver.flush(build);
    });
    return () => {
      unsubscribe();
      app.remove();
      resumeSaver.cancel();
    };
  }, [userId, accountId, symbol, timeframe]);
}
