import { MetaPixel } from "@/components/seo/MetaPixel";
import { googleSignInEnabled } from "@/lib/google-oauth";
import { metaPixelId } from "@/lib/meta-pixel";
import { RegisterForm } from "./RegisterForm";

// Read GOOGLE_CLIENT_ID/SECRET and META_PIXEL_ID at request time, not at build time.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <>
      <RegisterForm googleEnabled={googleSignInEnabled()} />
      <MetaPixel pixelId={metaPixelId()} />
    </>
  );
}
