import type { NextRequest } from "next/server";
import { createAffiliateLink, listAffiliateLinks } from "@asm/db";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession, noStoreJson, rateLimited, unauthenticated } from "@/lib/request-session";
import { refusedResponse } from "../refused";

const LinkInput = z.strictObject({ kind: z.enum(["HOME", "REGISTER", "APP"]), comment: z.string().trim().max(200).optional() });

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  if (session.role !== "AFFILIATE") return noStoreJson({ error: "Affiliate account required." }, { status: 403 });
  if (!await checkRateLimit(`rl:program-read:${session.userId}`, 120, 60)) return rateLimited();
  try {
    return noStoreJson({ links: await listAffiliateLinks(session.userId) });
  } catch (err) {
    return refusedResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  if (session.role !== "AFFILIATE") return noStoreJson({ error: "Affiliate account required." }, { status: 403 });
  if (!await checkRateLimit(`rl:affiliate-links:${session.userId}`, 20, 60)) return rateLimited();
  const parsed = LinkInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Choose a link type and use up to 200 characters for the comment." }, { status: 400 });
  try {
    const { kind, comment } = parsed.data;
    const link = await createAffiliateLink(session.userId, { kind, ...(comment !== undefined && { comment }) });
    return noStoreJson({ link }, { status: 201 });
  } catch (err) {
    return refusedResponse(err);
  }
}
