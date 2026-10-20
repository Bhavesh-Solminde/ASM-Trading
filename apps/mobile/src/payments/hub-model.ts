/** How many recent payments the Payments tab previews before "See all". */
export const RECENT_LIMIT = 5;

interface LiveAccount {
  id: string;
  currency: string;
  realBalance: number;
  bonusBalance: number;
}

export interface HubBalances {
  currency: string;
  /** Real plus bonus: the figure at the top of the tab. */
  totalMinor: number;
  /** `null` until the wallet's own figure has arrived. */
  withdrawableMinor: number | null;
  bonusMinor: number;
}

/**
 * The Payments tab's figures. The total follows the socket's balance for the live account (it moves with every
 * trade), falling back to the wallet's. Withdrawable is the wallet's server-computed figure, capped at the real
 * balance the socket reports so a loss never leaves it showing money that is gone.
 */
export function hubBalances(input: {
  live: LiveAccount | undefined;
  socket: { realBalance: number; bonusBalance: number } | undefined;
  withdrawable: number | undefined;
  lockedBonus: number | undefined;
}): HubBalances | null {
  const { live, socket } = input;
  if (!live) return null;
  const real = socket?.realBalance ?? live.realBalance;
  const bonus = socket?.bonusBalance ?? input.lockedBonus ?? live.bonusBalance;
  const total = socket ? socket.realBalance + socket.bonusBalance : live.realBalance + live.bonusBalance;
  const withdrawable = input.withdrawable === undefined ? null : socket ? Math.min(input.withdrawable, real) : input.withdrawable;
  return { currency: live.currency, totalMinor: total, withdrawableMinor: withdrawable, bonusMinor: bonus };
}

/** The "next step" card is for people who have not started verification or were rejected; in review and verified hide it. */
export function showKycNextStep(status: string | undefined): boolean {
  return status === "NOT_STARTED" || status === "REJECTED";
}
