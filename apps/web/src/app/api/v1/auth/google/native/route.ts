import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { findUserByEmail } from "@asm/db";
import { childLogger } from "@asm/logger";
import { deviceNameFrom } from "@/lib/app-client";
import { signInWithGoogleProfile } from "@/lib/google-account";
import { googleAndroidClientIds, googleNativeAudiences, verifyNativeIdToken } from "@/lib/google-native";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { noStoreJson, rateLimited } from "@/lib/request-session";
import { createSession } from "@/lib/session";

const Body = z.strictObject({ idToken: z.string().min(20).max(4096) });
const failed = (status: number) =>
  NextResponse.json({ error: "Google sign-in failed.", code: "google_failed" }, { status });

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const audiences = googleNativeAudiences();
  if (audiences.length === 0) {
    return NextResponse.json({ error: "Google sign-in is not available.", code: "google_disabled" }, { status: 503 });
  }
  if (!(await checkRateLimit(`rl:google_native:ip:${ctx.ip}`, 20, 300))) return rateLimited();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failed(400);

  const webClientId = process.env["GOOGLE_CLIENT_ID"]?.trim();
  let profile;
  try {
    profile = await verifyNativeIdToken(parsed.data.idToken, {
      audiences,
      androidClientIds: googleAndroidClientIds(),
      ...(webClientId ? { webClientId } : {}),
    });
  } catch (err) {
    log.info({ evt: "auth.google_failed", reason: err instanceof Error ? err.message : "verify" }, "native google failed");
    return failed(401);
  }

  const existing = await findUserByEmail(profile.email);
  const guardInput = existing
    ? { ip: ctx.ip, route: "google_native", log, userId: existing.id }
    : { ip: ctx.ip, route: "google_native", log };
  if ((await checkNetwork(guardInput)).blocked) return vpnBlockedResponse();

  let result;
  try {
    result = await signInWithGoogleProfile(profile, ctx, log);
  } catch (err) {
    log.warn({ evt: "auth.google_failed", reason: err instanceof Error ? err.name : "link" }, "native google link failed");
    return failed(401);
  }

  const token = await createSession(result.userId, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    client: "APP",
    deviceName: deviceNameFrom(req.headers),
  });
  return noStoreJson({ token, userId: result.userId, created: result.created });
}
