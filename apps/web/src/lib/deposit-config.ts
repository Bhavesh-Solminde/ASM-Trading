import type { DepositConfig } from "@asm/contracts";
import { countCompletedDeposits } from "@asm/db";
import { BONUS_TIERS } from "./bonus";
import { upiDepositsEnabled } from "./upi-collection";
import { listEnabledUsdtNetworks, usdtGatewayActive } from "./usdt-networks";

/** What the deposit flow needs to offer methods — shared by the page and the app route. */
export async function loadDepositConfig(userId: string): Promise<DepositConfig> {
  const usdtNetworks = listEnabledUsdtNetworks();
  return {
    upiEnabled: upiDepositsEnabled(),
    usdtNetworks,
    gatewayNetworks: usdtNetworks.filter((n) => usdtGatewayActive(n)),
    completedDeposits: await countCompletedDeposits(userId),
    bonusTiers: [...BONUS_TIERS],
  };
}
