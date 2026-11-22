import type { NextResponse } from "next/server";
import { recordAffiliateLinkClick } from "@asm/db";
import { childLogger } from "@asm/logger";
import { checkRateLimit } from "./rate-limit";
import { CLEAR_REFERRAL_LINK_COOKIE, REFERRAL_COOKIE, REFERRAL_COOKIE_OPTIONS, REFERRAL_LINK_COOKIE } from "./referral";
import type { RequestContext } from "./request-context";

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
