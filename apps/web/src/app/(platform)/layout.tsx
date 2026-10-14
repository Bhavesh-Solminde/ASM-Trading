import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { childLogger, newCorrelationId } from "@asm/logger";
import { PlatformProvider, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { loadPlatformBootstrap } from "@/lib/platform-bootstrap";
import { PlatformShell } from "@/components/shell/PlatformShell";
import { checkNetwork } from "@/lib/network-guard/guard";
import { clientIpFrom } from "@/lib/request-context";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const network = await checkNetwork({
    ip: clientIpFrom(await headers()),
    route: "platform_layout",
    log: childLogger(newCorrelationId()),
    userId: session.userId,
  });
  if (network.blocked) redirect("/network-blocked");

  const boot = await loadPlatformBootstrap(session.userId);

  return (
    <PlatformProvider
      assets={boot.assets as PlatformAsset[]}
      accounts={boot.accounts.map((a) => ({ id: a.id, type: a.type, currency: a.currency }))}
      initialBalances={Object.fromEntries(
        boot.accounts.map((a) => [a.id, { realBalance: a.realBalance, bonusBalance: a.bonusBalance }]),
      )}
      initialTrades={boot.recentTrades}
      defaultSymbol={boot.defaultSymbol}
      liveAccess={boot.liveAccess}
      completedDeposits={boot.completedDeposits}
    >
      <PlatformShell>{children}</PlatformShell>
    </PlatformProvider>
  );
}
