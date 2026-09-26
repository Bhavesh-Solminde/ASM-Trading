import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadProfile } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { ReferralClient } from "./ReferralClient";

export const dynamic = "force-dynamic";

export default async function ReferralPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const profile = await loadProfile(session.userId);
  const referralCode = profile?.nickname || `ASM${session.userId.slice(-6).toUpperCase()}`;
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://asmtrader.com";
  const referralUrl = `${origin}/register?ref=${referralCode}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8 phone:px-4 phone:py-5">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Referral Program</h1>
      <ReferralClient referralCode={referralCode} referralUrl={referralUrl} />
    </main>
  );
}
