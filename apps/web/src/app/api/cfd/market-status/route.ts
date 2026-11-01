import { NextRequest, NextResponse } from "next/server";
import { engineMarketStatus } from "@/lib/engine-client";
import { getSession, unauthenticated } from "@/lib/request-session";
export async function GET(req:NextRequest) {
  if (!await getSession(req)) return unauthenticated();
  const symbol=req.nextUrl.searchParams.get("symbol") ?? "";
  try {return NextResponse.json(await engineMarketStatus(symbol), {headers:{"Cache-Control":"no-store"}});}
  catch {return NextResponse.json({symbol,status:"unavailable"},{headers:{"Cache-Control":"no-store"}});}
}
