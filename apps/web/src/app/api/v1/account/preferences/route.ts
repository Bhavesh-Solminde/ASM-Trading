import { NextResponse, type NextRequest } from "next/server";
import { PreferencesSchema, PreferencesUpdateSchema } from "@asm/contracts";
import { prisma, setLocale } from "@asm/db";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const parsed = PreferencesUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unsupported preference.", code: "bad_request" }, { status: 400 });
  }
  if (parsed.data.locale) await setLocale(session.userId, parsed.data.locale);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { locale: true } });
  return noStoreJson(PreferencesSchema.parse({ locale: user.locale }));
}
