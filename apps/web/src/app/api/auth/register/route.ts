import { NextResponse, type NextRequest } from "next/server";
import { RegisterSchema } from "@asm/contracts";
import { findUserByEmail, prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { hashPassword } from "@/lib/password";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  createSession,
} from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { provisionNewUser } from "@/lib/signup";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  // Per-IP only — there's no "account" yet at this point in the flow.
  const okIp = await checkRateLimit(`rl:register:ip:${ctx.ip}`, 5, 3600);
  if (!okIp) {
    log.warn(
      { evt: "security.rate_limited", route: "register" },
      "register throttled",
    );
    return NextResponse.json(
      { error: "Too many attempts. Wait an hour and try again." },
      { status: 429 },
    );
  }

  if ((await checkNetwork({ ip: ctx.ip, route: "register", log })).blocked) {
    return vpnBlockedResponse();
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = RegisterSchema.safeParse(body);

  if (!parsed.success) {
    // A rejected unknown key here is a privilege-escalation attempt worth seeing.
    log.warn(
      { evt: "security.validation_rejected", route: "register" },
      "invalid registration payload",
    );
    return NextResponse.json(
      { error: "Check the details you entered and try again." },
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  if (await findUserByEmail(email)) {
    log.info({ evt: "auth.register_duplicate" }, "email already registered");
    return NextResponse.json(
      { error: "That email is already registered." },
      { status: 409 },
    );
  }

  // role is never set here — it defaults to USER in the schema.
  // The full name prefills KYC: first word → firstName, the rest → lastName.
  const [firstName, ...rest] = name.split(/\s+/);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      firstName: firstName ?? null,
      lastName: rest.length > 0 ? rest.join(" ") : null,
    },
    select: { id: true },
  });

  await provisionNewUser(user.id, ctx);

  const token = await createSession(user.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  log.info({ evt: "auth.register", userId: user.id }, "account created");

  const response = NextResponse.json({ userId: user.id }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
}
