import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ensureReferralCode, formatMoney, getProgramSummary } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { absoluteUrl } from "@/lib/site";
import { PageFrame } from "@/components/shell/PageFrame";
import { ReferralClient } from "./ReferralClient";

export const dynamic = "force-dynamic";

export default async function ReferralPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  if (session.role === "AFFILIATE") redirect("/affiliate/dashboard");

  const [referralCode, s] = await Promise.all([ensureReferralCode(session.userId), getProgramSummary(session.userId)]);
  const referralUrl = absoluteUrl(`/invite/${referralCode}`);
  // Everything earned so far: not yet released, ready, reserved for a withdrawal, moved or paid (held/void excluded).
  const earned = s.pendingMinor + s.availableMinor + s.reservedMinor + s.transferredMinor + s.paidMinor;

  return (
    <PageFrame width="base" title="Referral program">
      <ReferralClient
        referralCode={referralCode}
        referralUrl={referralUrl}
        stats={{ totalReferrals: s.totalReferrals, activeTraders: s.qualifiedUsers, totalEarned: formatMoney(earned, "INR") }}
      />
    </PageFrame>
  );
}
