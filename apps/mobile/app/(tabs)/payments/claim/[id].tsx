import { useLocalSearchParams } from "expo-router";
import { ClaimForm } from "@/payments/ClaimForm";
import { UsdtClaimForm } from "@/payments/UsdtClaimForm";

/**
 * `/payments/claim/<deposit id>`: tell us about a payment the automatic match has not found. By default the UTR of a
 * UPI payment; with `kind=usdt` the transaction hash of a USDT payment (`token` is the checkout token it came from,
 * which lets the form show the deposit's details).
 */
export default function Claim() {
  const { id, kind, token } = useLocalSearchParams<{ id: string; kind?: string; token?: string }>();
  const depositId = typeof id === "string" ? id : "";
  if (kind === "usdt") return <UsdtClaimForm depositId={depositId} token={typeof token === "string" ? token : ""} />;
  return <ClaimForm depositId={depositId} />;
}
