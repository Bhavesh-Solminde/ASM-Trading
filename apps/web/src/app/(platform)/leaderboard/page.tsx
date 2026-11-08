import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { loadLeaderboard } from "@/lib/leaderboard";
import { PageFrame } from "@/components/shell/PageFrame";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";

export const dynamic = "force-dynamic";


export default async function LeaderboardPage({ searchParams }: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const { view } = await searchParams;
  const requestedView = Array.isArray(view) ? view[0] : view;
  const { currency, result, mode, demoAvailable } = await loadLeaderboard(session.userId, requestedView);

  return (
    <PageFrame
      width="narrow"
      title="Leaderboard"
      description={result.source === "demo"
        ? "Development preview · Fictional profiles and simulated daily profits. Resets at midnight IST."
        : "Ranked by today's realized profit and loss across live accounts in South Asia and the Gulf. Resets at midnight IST."}
    >
      {demoAvailable && (
        <nav aria-label="Leaderboard views" className="mb-4 flex gap-2">
          {([["live", "Real traders"], ["demo", "Demo traders"]] as const).map(([value, label]) => (
            <Link
              key={value}
              href={`/leaderboard?view=${value}`}
              aria-current={mode === value ? "page" : undefined}
              className={`rounded px-3 py-2 text-sm font-semibold ${mode === value ? "bg-brand text-black" : "bg-panel text-ink-2 hover:text-ink"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      <LeaderboardView result={result} currency={currency} />
    </PageFrame>
  );
}
