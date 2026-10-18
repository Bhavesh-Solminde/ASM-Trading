import type { NextRequest } from "next/server";
import { BootstrapSchema } from "@asm/contracts";
import { loadProfile } from "@asm/db";
import { childLogger } from "@asm/logger";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { loadPlatformBootstrap } from "@/lib/platform-bootstrap";
import { requestContext } from "@/lib/request-context";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const ctx = requestContext(req);
  const network = await checkNetwork({ ip: ctx.ip, route: "app_bootstrap", log: childLogger(ctx.cid), userId: session.userId });
  if (network.blocked) return vpnBlockedResponse();

  const [boot, profile] = await Promise.all([loadPlatformBootstrap(session.userId), loadProfile(session.userId)]);
  return noStoreJson(
    BootstrapSchema.parse({
      ...boot,
      userId: session.userId,
      profile: { nickname: profile.nickname, email: profile.email, kycStatus: profile.kycStatus, locale: profile.locale },
    }),
  );
}
