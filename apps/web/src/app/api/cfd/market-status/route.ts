import { NextRequest, NextResponse } from "next/server";
import { engineMarketStatus } from "@/lib/engine-client";
import { readSession, SESSION_COOKIE } from "@/lib/session";
export async function GET(req:NextRequest) {
  if (!await readSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.json({error:"Not signed in"},{status:401});
  const symbol=req.nextUrl.searchParams.get("symbol") ?? "";
  try {return NextResponse.json(await engineMarketStatus(symbol), {headers:{"Cache-Control":"no-store"}});}
  catch {return NextResponse.json({symbol,status:"unavailable"},{headers:{"Cache-Control":"no-store"}});}
}
