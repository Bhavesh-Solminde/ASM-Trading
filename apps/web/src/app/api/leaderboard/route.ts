import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { loadLeaderboard } from "@/lib/leaderboard";


export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { result } = await loadLeaderboard(session.userId, req.nextUrl.searchParams.get("view"));

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
