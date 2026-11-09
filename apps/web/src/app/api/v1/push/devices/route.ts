import { checkRateLimit } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";
import { RegisterDeviceSchema, UnregisterDeviceSchema } from "@asm/contracts";
import { deletePushDevice, upsertPushDevice } from "@asm/db";
import { getSession, unauthenticated, rateLimited } from "@/lib/request-session";

const bad = () => NextResponse.json({ error: "Invalid device.", code: "bad_request" }, { status: 400 });

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  if (!(await checkRateLimit(`rl:push:register:${session.userId}`, 60, 300))) return rateLimited();
  const parsed = RegisterDeviceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  const d = parsed.data;
  await upsertPushDevice({
    userId: session.userId,
    platform: d.platform,
    token: d.token,
    p256dh: d.platform === "WEBPUSH" ? d.p256dh : null,
    auth: d.platform === "WEBPUSH" ? d.auth : null,
  });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  const parsed = UnregisterDeviceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  await deletePushDevice(session.userId, parsed.data.token);
  return new NextResponse(null, { status: 204 });
}
