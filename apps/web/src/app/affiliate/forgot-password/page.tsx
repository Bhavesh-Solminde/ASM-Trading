import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/app/(auth)/forgot-password/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your affiliate password", robots: { index: false, follow: false } };

export default function AffiliateForgotPasswordPage() {
  return <ForgotPasswordForm portal="affiliate" />;
}
