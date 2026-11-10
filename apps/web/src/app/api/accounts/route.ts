import { NextResponse,type NextRequest } from "next/server";
import { listAccountsForActor } from "@asm/db";
import { SESSION_COOKIE,readSession } from "@/lib/session";

/** Own-account bootstrap for normal signed-in clients; no account mutation. */
export async function GET(req:NextRequest){
  const session=await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if(!session)return NextResponse.json({error:"Not signed in."},{status:401});
  const accounts=await listAccountsForActor(session.userId);
  return NextResponse.json({accounts:accounts.map(a=>({id:a.id,type:a.type,currency:a.currency,realBalance:a.realBalance,bonusBalance:a.bonusBalance}))},{headers:{"Cache-Control":"no-store"}});
}
