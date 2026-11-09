import { minStakeMinor } from "@asm/client-core";
import { money } from "@/money/format";
import { MAX_STAKE_MINOR, type StakeCheck } from "./stake-input";

type T = (key: string, options?: Record<string, unknown>) => string;

/**
 * The one-line reason the entered stake cannot be traded, or null when there is nothing to say (valid, or still
 * empty). The Dock shows it inside the amount box in place of the "Amount" label.
 */
export function stakeProblemText(check: StakeCheck, currency: string, t: T): string | null {
  if (check.ok) return null;
  switch (check.reason) {
    case "min":
      return t("trade.minStake", { amount: money(minStakeMinor(currency), currency) });
    case "max":
      return t("trade.maxStake", { amount: money(MAX_STAKE_MINOR, currency) });
    case "balance":
      return t("trade.insufficient");
    default:
      return null;
  }
}
