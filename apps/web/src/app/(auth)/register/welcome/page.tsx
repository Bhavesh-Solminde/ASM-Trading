import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MetaPixel } from "@/components/seo/MetaPixel";
import { metaPixelIds } from "@/lib/meta-pixel";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { SignupComplete } from "./SignupComplete";

// Read META_PIXEL_ID at request time, not at build time.
export const dynamic = "force-dynamic";

/**
 * Landing hop for Google signups: the OAuth callback redirects server-side,
 * so the pixel's CompleteRegistration event is fired here before moving on to
 * /trade. Signed-out visitors are sent to /register so the event can't be
 * triggered without an account.
 */
export default async function SignupWelcomePage() {
  const store = await cookies();
  if (!(await readSession(store.get(SESSION_COOKIE)?.value))) redirect("/register");
  return (
    <>
      <MetaPixel pixelIds={metaPixelIds()} />
      <SignupComplete />
    </>
  );
}
