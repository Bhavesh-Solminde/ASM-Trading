import type { Metadata } from "next";
import { LoginForm } from "@/app/(auth)/login/LoginForm";

export const metadata: Metadata = { title: "Affiliate log in", robots: { index: false, follow: false } };

export default async function AffiliateLoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <LoginForm
      portal="affiliate"
      googleEnabled={false}
      googleError={false}
      notice={reset === "1" ? "Password updated. Log in with your new affiliate password." : null}
    />
  );
}
