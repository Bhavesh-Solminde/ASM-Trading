// Client-safe: display strings only, derived from the stored Deposit.network /
// ChainCredit.network id. No config, no addresses.
import { USDT_NETWORK_INFO, isUsdtNetwork } from "@asm/contracts";

export interface UsdtNetworkDisplay {
  /** Chain name, e.g. "BNB Smart Chain"; the raw id when unknown. */
  label: string;
  /** Token standard, e.g. "BEP-20"; null when unknown. */
  standard: string | null;
  /** "BNB Smart Chain (BEP-20)"; the raw id when unknown. */
  shortLabel: string;
  /** "USDT (BEP-20)"; plain "USDT" when unknown. */
  assetLabel: string;
  /**
   * Network-specific "wrong network" warning, shown prominently on the
   * checkout and claim pages. Null where the generic line suffices.
   */
  warning: string | null;
}

const WARNINGS: Record<string, string> = {
  bsc: "Send only on BNB Smart Chain (BEP-20). BSC and Ethereum addresses look identical — a transfer on Ethereum or any other network will not arrive here.",
};

export function usdtNetworkDisplay(network: string | null | undefined): UsdtNetworkDisplay {
  const raw = network ?? "";
  if (isUsdtNetwork(raw)) {
    const info = USDT_NETWORK_INFO[raw];
    return {
      label: info.label,
      standard: info.standard,
      shortLabel: info.shortLabel,
      assetLabel: `USDT (${info.standard})`,
      warning: WARNINGS[raw] ?? null,
    };
  }
  const fallback = raw || "unknown network";
  return { label: fallback, standard: null, shortLabel: fallback, assetLabel: "USDT", warning: null };
}
