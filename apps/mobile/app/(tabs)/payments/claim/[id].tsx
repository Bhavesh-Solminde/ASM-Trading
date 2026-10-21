import { useLocalSearchParams } from "expo-router";
import { ClaimForm } from "@/payments/ClaimForm";

/** `/payments/claim/<deposit id>`: add the UTR of a UPI payment the automatic match has not found. */
export default function Claim() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClaimForm depositId={typeof id === "string" ? id : ""} />;
}
