import { redirect } from "next/navigation";
import { normaliseReferralCode } from "@asm/db";
import { MetaPixel } from "@/components/seo/MetaPixel";
import { googleSignInEnabled } from "@/lib/google-oauth";
import { metaPixelIds } from "@/lib/meta-pixel";
import { RegisterForm } from "./RegisterForm";

// Read GOOGLE_CLIENT_ID/SECRET and META_PIXEL_ID at request time, not at build time.
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  // /register?ref=CODE is credited like an invitation link: /invite stores the
  // code (only if valid) and comes back here without the parameter.
  const { ref } = await searchParams;
  const code = typeof ref === "string" ? normaliseReferralCode(ref) : null;
  if (code) redirect(`/invite/${code}`);

  return (
    <>
      <RegisterForm googleEnabled={googleSignInEnabled()} />
      <MetaPixel pixelIds={metaPixelIds()} />
    </>
  );
}
