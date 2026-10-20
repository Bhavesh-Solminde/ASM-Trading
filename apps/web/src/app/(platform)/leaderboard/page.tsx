import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dailyLeaderboard, leaderboardCurrencyFor } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { startOfDayMs } from "@/lib/day";
import { PageFrame } from "@/components/shell/PageFrame";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";

export const dynamic = "force-dynamic";

const INCLUDE_BOTS = process.env.LEADERBOARD_INCLUDE_BOTS !== "false";

export default async function LeaderboardPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const currency = await leaderboardCurrencyFor(session.userId);
  const result = await dailyLeaderboard({
    sinceMs: startOfDayMs(Date.now()),
    viewerUserId: session.userId,
    limit: 10,
    includeBots: INCLUDE_BOTS,
    displayCurrency: currency,
  });

  return (
    <PageFrame
      width="narrow"
      title="Leaderboard"
      description="Ranked by today's realized profit and loss across live accounts in South Asia and the Gulf. Resets at midnight IST."
    >
      <LeaderboardView result={result} currency={currency} />
    </PageFrame>
  );
}
