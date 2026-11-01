import { NextResponse, type NextRequest } from "next/server";
import { PreferencesSchema, PreferencesUpdateSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

const select = { locale: true, notifyTrades: true, notifyPayments: true, notifyAccount: true } as const;
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  const prefs = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select });
  return noStoreJson(PreferencesSchema.parse(prefs));
}
export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  const parsed = PreferencesUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unsupported preference.", code: "bad_request" }, { status: 400 });
  const prefs = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: session.userId }, data: {
      ...(parsed.data.locale !== undefined ? { locale: parsed.data.locale } : {}),
      ...(parsed.data.notifyTrades !== undefined ? { notifyTrades: parsed.data.notifyTrades } : {}),
      ...(parsed.data.notifyPayments !== undefined ? { notifyPayments: parsed.data.notifyPayments } : {}),
      ...(parsed.data.notifyAccount !== undefined ? { notifyAccount: parsed.data.notifyAccount } : {}),
    }, select });
    if (parsed.data.locale) await tx.pushDevice.updateMany({ where: { userId: session.userId }, data: { locale: parsed.data.locale } });
    return user;
  });
  return noStoreJson(PreferencesSchema.parse(prefs));
}
