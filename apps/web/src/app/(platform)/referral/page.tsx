import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadProfile } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PageFrame } from "@/components/shell/PageFrame";
import { ReferralClient } from "./ReferralClient";

export const dynamic = "force-dynamic";

export default async function ReferralPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const profile = await loadProfile(session.userId);
  const referralCode = profile?.nickname || `IXT${session.userId.slice(-6).toUpperCase()}`;
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://indianxtrade.com";
  const referralUrl = `${origin}/register?ref=${referralCode}`;

  return (
    <PageFrame width="base" title="Referral program">
      <ReferralClient referralCode={referralCode} referralUrl={referralUrl} />
    </PageFrame>
  );
}
