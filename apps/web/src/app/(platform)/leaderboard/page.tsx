import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { loadLeaderboard } from "@/lib/leaderboard";
import { PageFrame } from "@/components/shell/PageFrame";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";

export const dynamic = "force-dynamic";


export default async function LeaderboardPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const { currency, result } = await loadLeaderboard(session.userId);

  return (
    <PageFrame
      width="narrow"
      title="Leaderboard"
      description={result.source === "demo"
        ? "Development preview · Fictional profiles and simulated daily profits. Resets at midnight IST."
        : "Ranked by today's realized profit and loss across live accounts in South Asia and the Gulf. Resets at midnight IST."}
    >
      <LeaderboardView result={result} currency={currency} />
    </PageFrame>
  );
}
