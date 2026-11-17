import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normaliseReferralCode, resolveInvitationCode } from "@asm/db";
import { MetaPixel } from "@/components/seo/MetaPixel";
import { googleSignInEnabled } from "@/lib/google-oauth";
import { metaPixelIds } from "@/lib/meta-pixel";
import { REFERRAL_COOKIE, invitedFirstDepositBonusPct } from "@/lib/referral";
import { RegisterForm } from "./RegisterForm";

// Read GOOGLE_CLIENT_ID/SECRET and META_PIXEL_ID at request time, not at build time.
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  // /register?ref=CODE is credited like an invitation link: /invite stores the
  // code (only if valid) and comes back here without the parameter.
  const { ref } = await searchParams;
  const code = typeof ref === "string" ? normaliseReferralCode(ref) : null;
  if (code) redirect(`/invite/${code}`);

  // Arrived through an invitation link: show the friend's bonus and prefill the code.
  const invited = normaliseReferralCode((await cookies()).get(REFERRAL_COOKIE)?.value ?? "");
  const invite =
    invited && (await resolveInvitationCode(invited))
      ? { initialReferralCode: invited, inviteBonusPct: await invitedFirstDepositBonusPct() }
      : {};

  return (
    <>
      <RegisterForm
        googleEnabled={googleSignInEnabled()}
        {...invite}
      />
      <MetaPixel pixelIds={metaPixelIds()} />
    </>
  );
}
