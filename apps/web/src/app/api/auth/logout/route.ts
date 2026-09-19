import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
