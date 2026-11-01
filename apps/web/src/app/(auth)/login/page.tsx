import { MetaPixel } from "@/components/seo/MetaPixel";
import { googleSignInEnabled } from "@/lib/google-oauth";
import { metaPixelIds } from "@/lib/meta-pixel";
import { LoginForm } from "./LoginForm";

// Read GOOGLE_CLIENT_ID/SECRET and META_PIXEL_ID at request time, not at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;
  return (
    <>
      <LoginForm
        googleEnabled={googleSignInEnabled()}
        googleError={error === "google"}
        notice={reset === "1" ? "Password updated. Log in with your new password." : null}
      />
      <MetaPixel pixelIds={metaPixelIds()} />
    </>
  );
}
