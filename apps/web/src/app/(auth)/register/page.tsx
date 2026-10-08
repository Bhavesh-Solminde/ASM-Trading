import { googleSignInEnabled } from "@/lib/google-oauth";
import { RegisterForm } from "./RegisterForm";

// Read GOOGLE_CLIENT_ID/SECRET at request time, not at build time.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return <RegisterForm googleEnabled={googleSignInEnabled()} />;
}
