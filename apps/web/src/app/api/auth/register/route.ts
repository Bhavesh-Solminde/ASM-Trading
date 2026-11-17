import { NextResponse, type NextRequest } from "next/server";
import { noStoreJson, rateLimited } from "@/lib/request-session";
import { RegisterSchema } from "@asm/contracts";
import {
  EMAIL_VERIFICATION_TTL_MS,
  bonusPercentForDeposit,
  ensureAffiliateProfile,
  findUserByEmail,
  findUserById,
  issueEmailVerificationToken,
  portalWhere,
  prisma,
  resolveInvitationCode,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { sendVerifyEmail, sendWelcomeEmail } from "@asm/mail";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { hashPassword } from "@/lib/password";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  createSession,
} from "@/lib/session";
import { deviceNameFrom, isAppRequest } from "@/lib/app-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { CLEAR_REFERRAL_COOKIE, REFERRAL_COOKIE, attachSignupReferral } from "@/lib/referral";
import { provisionNewUser } from "@/lib/signup";
import { absoluteUrl } from "@/lib/site";

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
    return rateLimited("Too many attempts. Wait an hour and try again.");
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

  const { name, email, password, portal } = parsed.data;
  const affiliate = portal === "affiliate";
  // Affiliate signups never carry a referral. A typed code is the latest explicit choice, so it beats the link cookie.
  const typedCode = affiliate ? "" : (parsed.data.referralCode ?? "");
  const cookieCode = affiliate ? "" : (req.cookies.get(REFERRAL_COOKIE)?.value ?? "");

  // Main portal: refuse if ANY USER or ADMIN row has this email (findUserByEmail
  // returns null when both exist, so count instead).
  const taken = affiliate
    ? (await findUserByEmail(email, "affiliate")) !== null
    : (await prisma.user.count({ where: { email, ...portalWhere("main") } })) > 0;
  if (taken) {
    log.info({ evt: "auth.register_duplicate" }, "email already registered");
    return NextResponse.json(
      { error: "That email is already registered." },
      { status: 409 },
    );
  }

  if (typedCode) {
    const resolved = await resolveInvitationCode(typedCode);
    if (!resolved) {
      return NextResponse.json(
        { error: "That invitation code isn't valid.", code: "invalid_referral" },
        { status: 400 },
      );
    }
    if ((await findUserById(resolved.inviterId))?.email.toLowerCase() === email) {
      return NextResponse.json(
        { error: "You can't use your own invitation code.", code: "self_referral" },
        { status: 400 },
      );
    }
  }

  // role comes only from the portal, never from the body: USER by default,
  // AFFILIATE (unverified until the emailed link is opened) for that portal.
  // The full name prefills KYC: first word → firstName, the rest → lastName.
  const [firstName, ...rest] = name.split(/\s+/);
  let user: { id: string };
  try {
    const passwordHash = await hashPassword(password);
    // An affiliate without its profile is broken, so both rows commit together or not at all.
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          ...(affiliate && { role: "AFFILIATE" as const, emailVerified: false }),
          passwordHash,
          firstName: firstName ?? null,
          lastName: rest.length > 0 ? rest.join(" ") : null,
        },
        select: { id: true },
      });
      if (affiliate) await ensureAffiliateProfile(created.id, tx);
      return created;
    });
  } catch (err) {
    // A concurrent signup with the same email in this portal won the race.
    if ((err as { code?: string }).code !== "P2002") throw err;
    log.info({ evt: "auth.register_duplicate", race: true }, "email already registered");
    return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
  }

  await provisionNewUser(user.id, ctx);
  // After provisioning so the signup IP/UA capture exists; still re-checked race-safely inside.
  if (typedCode) await attachSignupReferral({ userId: user.id, code: typedCode, via: "CODE" }, ctx, log);
  else if (cookieCode) await attachSignupReferral({ userId: user.id, code: cookieCode, via: "LINK" }, ctx, log);

  const app = isAppRequest(req.headers);
  const token = await createSession(user.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    client: app ? "APP" : "WEB",
    deviceName: app ? deviceNameFrom(req.headers) : null,
  });

  log.info({ evt: "auth.register", userId: user.id, portal }, "account created");

  // Not awaited: signup must not wait on, or fail because of, mail.
  if (affiliate) {
    const issued = await issueEmailVerificationToken(user.id);
    void sendVerifyEmail({
      to: email,
      cid: ctx.cid,
      tokenId: issued.id,
      name: firstName ?? name,
      verifyUrl: absoluteUrl(`/api/auth/verify-email?token=${issued.token}`),
      ttlHours: EMAIL_VERIFICATION_TTL_MS / 3_600_000,
    });
  } else {
    void sendWelcomeEmail({
      to: email,
      cid: ctx.cid,
      userId: user.id,
      name: firstName ?? name,
      firstDepositBonusPercent: bonusPercentForDeposit(1),
    });
  }

  if (app) return noStoreJson({ token, userId: user.id }, { status: 201 });

  const response = NextResponse.json({ userId: user.id }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  if (!affiliate) response.cookies.set(CLEAR_REFERRAL_COOKIE);
  return response;
}
