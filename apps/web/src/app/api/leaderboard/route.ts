import { NextResponse, type NextRequest } from "next/server";
import { dailyLeaderboard } from "@asm/db";
import { startOfDayMs } from "@/lib/day";
import { getSession, unauthenticated } from "@/lib/request-session";

// Populate the board with the trading bots by default so it reads like a live
// venue; flip to "false" to show only real LIVE traders.
const INCLUDE_BOTS = process.env.LEADERBOARD_INCLUDE_BOTS !== "false";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }

  const result = await dailyLeaderboard({
    sinceMs: startOfDayMs(Date.now()),
    viewerUserId: session.userId,
    limit: 100,
    includeBots: INCLUDE_BOTS,
  });

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
