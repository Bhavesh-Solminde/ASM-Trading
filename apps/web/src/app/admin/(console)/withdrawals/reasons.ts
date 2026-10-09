/** Preset withdrawal rejection reasons, shown to the user in their withdrawal history. */
export const WITHDRAWAL_REJECT_REASONS = [
  "The bank account details are incorrect",
  "The account holder name doesn't match your verified name",
  "The UPI ID couldn't receive the payment",
  "The wallet address or network is invalid",
  "This payout destination is linked to another account",
] as const;
