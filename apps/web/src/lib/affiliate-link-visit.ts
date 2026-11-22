import type { NextResponse } from "next/server";
import { recordAffiliateLinkClick } from "@asm/db";
import { childLogger } from "@asm/logger";
import { checkRateLimit } from "./rate-limit";
import { CLEAR_REFERRAL_LINK_COOKIE, REFERRAL_COOKIE, REFERRAL_COOKIE_OPTIONS, REFERRAL_LINK_COOKIE } from "./referral";
import type { RequestContext } from "./request-context";

export async function lookupReferralLink<T>(ctx: RequestContext, route: "invite" | "r", lookup: () => Promise<T>): Promise<T | null> {
  try {
    return await lookup();
  } catch (err) {
    childLogger(ctx.cid).warn({ evt: "referral.link_lookup_failed", route, err }, "could not look up referral link");
    return null;
  }
}

export async function rememberAffiliateLink(response: NextResponse, code: string, linkId: string | null, ctx: RequestContext) {
  response.cookies.set(REFERRAL_COOKIE, code, REFERRAL_COOKIE_OPTIONS);
  if (linkId) {
    response.cookies.set(REFERRAL_LINK_COOKIE, linkId, REFERRAL_COOKIE_OPTIONS);
    if (await checkRateLimit(`rl:affiliate-link:${linkId}:${ctx.ip}`, 1, 30 * 60)) {
      try {
        await recordAffiliateLinkClick(linkId);
      } catch (err) {
        childLogger(ctx.cid).warn({ evt: "affiliate.click_failed", linkId, err }, "could not record affiliate link click");
      }
    }
  } else {
    response.cookies.set(CLEAR_REFERRAL_LINK_COOKIE);
  }
}
