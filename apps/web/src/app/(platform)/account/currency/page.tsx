import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listAccountsForActor, withdrawableBalance } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PageFrame } from "@/components/shell/PageFrame";
import { CurrencyConvertCard, type AccountBalance } from "../CurrencyConvertCard";

export const dynamic = "force-dynamic";

export default async function CurrencyPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const accounts = await listAccountsForActor(session.userId);
  const live = accounts.find((a) => a.type === "LIVE");
  const liveWithdrawable = live ? (await withdrawableBalance(live.id)).withdrawable : undefined;

  const balances: AccountBalance[] = accounts.map((a) => ({
    id: a.id,
    type: a.type,
    currency: a.currency,
    realBalance: a.realBalance,
    bonusBalance: a.bonusBalance,
    ...(a.type === "LIVE" && liveWithdrawable !== undefined ? { withdrawable: liveWithdrawable } : {}),
  }));

  return (
    <PageFrame width="narrow" title="Currency" back={{ href: "/account", label: "Account" }}>
      <CurrencyConvertCard accounts={balances} />
    </PageFrame>
  );
}
