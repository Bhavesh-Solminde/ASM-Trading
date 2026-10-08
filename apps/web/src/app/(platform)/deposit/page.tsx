import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { countCompletedDeposits } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { DepositFlow } from "@/components/deposit/DepositFlow";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { listEnabledUsdtNetworks, usdtGatewayActive } from "@/lib/usdt-networks";
import { upiDepositsEnabled } from "@/lib/upi-collection";

export default async function DepositPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  const { expired } = await searchParams;
  // `expired` is either the legacy "1" or the checkout token of the USDT
  // deposit whose window just closed. Only a well-formed token earns the
  // claim link; the claim page itself enforces ownership.
  const expiredToken =
    typeof expired === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(expired) ? expired : null;
  const showExpired = expired === "1" || expiredToken !== null;
  // Only networks whose receiving config is complete (i.e. a watcher is on
  // them) are offered — the env is re-read per request.
  const usdtNetworks = listEnabledUsdtNetworks();
  const usdtGateway = usdtGatewayActive();
  const completedDeposits = await countCompletedDeposits(session.userId);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-8 phone:px-4 phone:py-5">
      <PlatformTabs />
      <header>
        <h1 className="text-xl font-bold tracking-tight">Deposit</h1>
      </header>

      {showExpired ? (
        <div className="rounded border border-[var(--color-down)]/30 bg-[var(--color-down)]/10 p-3 text-xs leading-relaxed text-[var(--color-down)]">
          {usdtGateway ? (
            <>
              Your payment window ended. If you already sent the payment before
              the timer ran out, it will still be credited automatically —
              don&rsquo;t send it again. Otherwise, start a new deposit below.
            </>
          ) : (
            <>
              Your 5-minute payment window ended. If you already sent the exact
              amount before the timer ran out, it will still be credited
              automatically — don&rsquo;t send it again. Otherwise, start a new
              deposit below.
            </>
          )}
          {expiredToken && !usdtGateway ? (
            <a
              href={`/checkout/${expiredToken}/claim`}
              className="mt-2 block font-semibold underline underline-offset-4"
            >
              Already sent it, or sent a different amount? Submit your transaction &rarr;
            </a>
          ) : null}
        </div>
      ) : null}

      <DepositFlow
        usdtNetworks={usdtNetworks}
        usdtGateway={usdtGateway}
        upiEnabled={upiDepositsEnabled()}
        completedDeposits={completedDeposits}
      />
    </main>
  );
}
