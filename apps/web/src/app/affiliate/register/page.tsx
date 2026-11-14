import type { Metadata } from "next";
import { RegisterForm } from "@/app/(auth)/register/RegisterForm";

export const metadata: Metadata = { title: "Become an affiliate", robots: { index: false, follow: false } };

export default function AffiliateRegisterPage() {
  return <RegisterForm portal="affiliate" googleEnabled={false} />;
}
