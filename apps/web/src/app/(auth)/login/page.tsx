import { googleSignInEnabled } from "@/lib/google-oauth";
import { LoginForm } from "./LoginForm";

// Read GOOGLE_CLIENT_ID/SECRET at request time, not at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginForm googleEnabled={googleSignInEnabled()} googleError={error === "google"} />;
}
