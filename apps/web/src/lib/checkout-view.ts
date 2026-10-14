import type { CheckoutView } from "@asm/contracts";
import type { getDepositByToken } from "@asm/db";
import { buildUpiDeepLink } from "@asm/client-core";
import { upiCollection, upiManualClaimDelaySec } from "./upi-collection";

type Deposit = NonNullable<Awaited<ReturnType<typeof getDepositByToken>>>;

/** The exact upi://pay link the checkout page renders — one builder for web and app. */
export function upiUriFor(deposit: Pick<Deposit, "id" | "vpa" | "amountInr">): string {
  const collection = upiCollection();
  return buildUpiDeepLink({
    vpa: deposit.vpa,
    payeeName: collection.payeeName,
    amountInr: deposit.amountInr,
    merchantCode: collection.merchantCode,
    note: `IXT-${deposit.id.slice(0, 8)}`,
  });
}

export function checkoutViewFor(deposit: Deposit): CheckoutView {
  const isUsdt = deposit.method === "USDT";
  return {
    id: deposit.id,
    method: deposit.method,
    status: deposit.status,
    amountInr: deposit.amountInr,
    amountUsdtMinor: deposit.amountUsdtMinor ?? null,
    network: deposit.network ?? null,
    expiresAt: deposit.expiresAt.toISOString(),
    upiUri: isUsdt ? null : upiUriFor(deposit),
    vpa: isUsdt ? null : deposit.vpa,
    receivingAddress: deposit.receivingAddress ?? null,
    isGateway: isUsdt && deposit.gateway !== null,
    isSlot: isUsdt && deposit.usdtMatch === "SLOT",
    claimedUtr: deposit.claimedUtr ?? null,
    claimedTxHash: deposit.claimedTxHash ?? null,
    manualClaimDelaySec: upiManualClaimDelaySec(),
  };
}
