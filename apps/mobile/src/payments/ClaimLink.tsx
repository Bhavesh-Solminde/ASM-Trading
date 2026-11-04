import { router } from "expo-router";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { useNow } from "@/trade/useNow";
import { claimAnchorMs, claimLinkVisible, claimReveal, createAnchorStore } from "./pay-model";

/** The fallback anchor (an older server sends no `createdAt`): one per app run, so reopening a payment's screen does not restart its claim delay. */
const anchors = createAnchorStore();

/**
 * "I've paid, add my UTR". Out `manualClaimDelaySec` seconds after the deposit was created, as on the website (the
 * server asks the app to give the automatic match its chance first; with no `createdAt`, from the first time this
 * screen opened for the payment), and only while the claim route would take it:
 * an open payment with no UTR sent. A leaf: it ticks once a second until it shows, then stops ticking.
 */
export function ClaimLink({ token, depositId, status, claimedUtr, delaySec, createdAt }: { token: string; depositId: string; status: string; claimedUtr: string | null; delaySec: number; createdAt: string | null }) {
  const { t } = useTranslation();
  const anchorMs = claimAnchorMs({ createdAt, firstOpenMs: anchors.anchorFor(token, Date.now()) });
  // The clock only drives re-renders while waiting; whether it is time is read from the live clock each render, so
  // the render that stops the ticking still shows the link.
  const { revealed } = claimReveal({ anchorMs, nowMs: Date.now(), delaySec });
  useNow(revealed || status !== "AWAITING_PAYMENT" || claimedUtr !== null ? null : 1000);
  if (!claimLinkVisible({ status, claimedUtr, revealed })) return null;
  return (
    <Pressable
      testID="pay-claim"
      accessibilityRole="link"
      onPress={() => router.push({ pathname: "/payments/claim/[id]", params: { id: depositId } })}
      style={{ minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }}
    >
      <Txt size={15} weight={500} color={color.accentText} style={{ textAlign: "center" }}>
        {t("pay.claimLink")}
      </Txt>
    </Pressable>
  );
}
