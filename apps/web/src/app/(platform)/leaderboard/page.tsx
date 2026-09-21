import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dailyLeaderboard } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { startOfDayMs } from "@/lib/day";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";

export const dynamic = "force-dynamic";

const INCLUDE_BOTS = process.env.LEADERBOARD_INCLUDE_BOTS !== "false";

export default async function LeaderboardPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const result = await dailyLeaderboard({
    sinceMs: startOfDayMs(Date.now()),
    viewerUserId: session.userId,
    limit: 100,
    includeBots: INCLUDE_BOTS,
  });

  return <LeaderboardView result={result} />;
}
