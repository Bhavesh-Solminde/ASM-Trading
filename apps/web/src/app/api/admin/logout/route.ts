import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, destroyAdminSession } from "@/lib/admin-session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (token) await destroyAdminSession(token);

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
