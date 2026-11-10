import { NextResponse, type NextRequest } from "next/server";
import { dailyLeaderboard, leaderboardCurrencyFor } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { startOfDayMs } from "@/lib/day";

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const result = await dailyLeaderboard({
    sinceMs: startOfDayMs(Date.now()),
    viewerUserId: session.userId,
    limit: 10,
    includeBots: false,
    displayCurrency: await leaderboardCurrencyFor(session.userId),
  });

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
