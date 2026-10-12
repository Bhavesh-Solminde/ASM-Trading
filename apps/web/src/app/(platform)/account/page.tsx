import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadProfile, listAccountsForActor, withdrawableBalance } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PageFrame } from "@/components/shell/PageFrame";
import { AccountHub, type HubAccount } from "@/components/account/AccountHub";
import { displayName } from "@/components/account/profile-display";
import { SignOutSection } from "./SignOutSection";

export const dynamic = "force-dynamic";

/** The Account tab: who you are, your balances, and the way into every setting. */
export default async function AccountPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [profile, accounts] = await Promise.all([
    loadProfile(session.userId),
    listAccountsForActor(session.userId),
  ]);
  const live = accounts.find((a) => a.type === "LIVE");
  const liveWithdrawable = live ? (await withdrawableBalance(live.id)).withdrawable : undefined;

  const hubAccounts: HubAccount[] = accounts.map((a) => ({
    id: a.id,
    type: a.type,
    currency: a.currency,
    balanceMinor: a.realBalance + a.bonusBalance,
    ...(a.type === "LIVE" && liveWithdrawable !== undefined ? { withdrawableMinor: liveWithdrawable } : {}),
  }));

  return (
    <PageFrame width="narrow" title="Account">
      <AccountHub
        name={displayName(profile)}
        email={profile.email}
        kycStatus={profile.kycStatus}
        accounts={hubAccounts}
        signOut={<SignOutSection />}
      />
    </PageFrame>
  );
}
