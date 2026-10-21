import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CheckoutView } from "@asm/contracts";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import { Money } from "@/ui/Money";
import { toast } from "@/ui/Toast";
import { QrCard, WaitingRing } from "./PayParts";
import { UsdtProgressCard } from "./UsdtProgressCard";
import { amountText, requestedAmount } from "./result-model";
import { networkLabel, networkNote, usdtAddressNoteKey, usdtAmountText, usdtHintKey, usdtSendExactlyAmount, usdtStatusLineKey } from "./usdt-display";
import { shownTxHash, usdtClaimEntry } from "./usdt-claim";
import { usdtShowsSupport, type UsdtProgress } from "./usdt-progress";

/** Copy `text`, say so in a toast; a clipboard that refuses says the generic error instead of failing silently. */
async function copyText(text: string, doneMessage: string, failedMessage: string) {
  try {
    await Clipboard.setStringAsync(text);
    toast(doneMessage, "up");
  } catch {
    toast(failedMessage, "down");
  }
}

/** A `surface` card that copies when pressed: a small label, the value, and the copy mark. At least 44pt tall. */
function CopyCard({ testID, label, hint, onCopy, children }: { testID: string; label: string; hint: string; onCopy: () => void; children: ReactNode }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${hint}`}
      onPress={onCopy}
      style={({ pressed }) => ({ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: color.rule, backgroundColor: color.surface, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Txt size={13} color={color.ink2}>
          {label}
        </Txt>
        {children}
      </View>
      <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name="copy" size={18} color={color.accentText} />
      </View>
    </Pressable>
  );
}

/**
 * The open USDT payment, in the UPI screen's frame: the address as a `paper` QR, the network and a prominent "send
 * only on this network" warning (a wrong network loses the money), the amount and the address with copy, and the rail's
 * sending rule. A gateway deposit has its own address and is detected by itself; a manual (shared-address) one also
 * offers "submit your transaction", the tx-hash claim. Polling lives in the screen, which passes the on-chain
 * `progress`: once a transfer has been seen, the progress card replaces the waiting line. The clock is the header's.
 */
export function UsdtPay({ view, token, progress }: { view: CheckoutView; token: string; progress: UsdtProgress }) {
  const { t } = useTranslation();
  const address = view.receivingAddress;
  const asked = requestedAmount(view);
  const shownAmount = amountText(asked.minor, asked.currency);
  const copyAmount = usdtAmountText(asked.minor);
  const note = networkNote(view.network);
  const label = networkLabel(view.network);
  const statusKey = usdtStatusLineKey({ status: view.status, isGateway: view.isGateway });
  const addressNoteKey = usdtAddressNoteKey({ isGateway: view.isGateway, isSlot: view.isSlot });
  const sendExactly = usdtSendExactlyAmount(view);
  const failed = t("common.genericError");

  return (
    <View style={{ gap: 20 }}>
      <View style={{ alignItems: "center", gap: 12 }}>
        <View testID="usdt-network" accessible accessibilityLabel={t("usdt.network", { network: label })} style={{ maxWidth: "100%", minHeight: 32, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: color.rule, backgroundColor: color.raised }}>
          <Txt size={13} weight={600} color={color.accentText} style={{ textAlign: "center", alignSelf: "stretch" }}>
            {t("usdt.network", { network: label })}
          </Txt>
        </View>
        <View testID="usdt-network-warning" accessibilityRole="alert" style={{ alignSelf: "stretch", gap: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: color.downText, backgroundColor: color.warnBg }}>
          <Txt size={15} weight={600} color={color.downText}>
            {t("usdt.sendOnly", { network: label })}
          </Txt>
          <Txt size={13} color={color.ink2}>
            {t(note.lookalike ? "usdt.wrongNetworkLookalike" : "usdt.wrongNetwork", { chain: note.chain })}
          </Txt>
        </View>
        {address ? <QrCard value={address} label={t("usdt.qrLabel")} /> : null}
        <Txt size={14} color={color.ink2} style={{ textAlign: "center" }}>
          {t("usdt.scanHint")}
        </Txt>
      </View>

      {sendExactly ? (
        <Txt testID="usdt-send-exactly" size={17} weight={600} style={{ textAlign: "center" }}>
          {t("usdt.sendExactly", { amount: sendExactly })}
        </Txt>
      ) : null}

      <View style={{ gap: 12 }}>
        <CopyCard testID="usdt-copy-amount" label={t("usdt.amount")} hint={t("usdt.copyAmount")} onCopy={() => void copyText(copyAmount, t("usdt.amountCopied"), failed)}>
          <Money text={shownAmount} size={22} weight={600} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} />
        </CopyCard>
        {address ? (
          <CopyCard testID="usdt-copy-address" label={t("usdt.address")} hint={t("usdt.copyAddress")} onCopy={() => void copyText(address, t("usdt.addressCopied"), failed)}>
            <Txt font="fig" size={13} lineHeight={20}>
              {address}
            </Txt>
          </CopyCard>
        ) : null}
        {addressNoteKey ? (
          <Txt size={13} weight={600} color={color.ink2}>
            {t(addressNoteKey)}
          </Txt>
        ) : null}
        <Txt testID="usdt-hint" size={13} color={color.ink2}>
          {t(usdtHintKey({ isGateway: view.isGateway, isSlot: view.isSlot }), { chain: note.chain })}
        </Txt>
      </View>

      {progress.detected ? <UsdtProgressCard progress={progress} /> : null}
      {usdtShowsSupport(progress.kind) ? <Button testID="usdt-contact-support" kind="text" label={t("pay.ended.contactSupport")} onPress={() => router.push("/account/support")} /> : null}
      {statusKey && !progress.detected ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, padding: 16, borderRadius: 14, backgroundColor: color.surface }}>
          <WaitingRing />
          <Txt testID="pay-status" accessibilityLiveRegion="polite" size={14} color={color.ink2} style={{ flex: 1 }}>
            {t(statusKey)}
          </Txt>
        </View>
      ) : null}

      <UsdtClaimEntry view={view} token={token} />
    </View>
  );
}

/**
 * "Submit your transaction" for a manual USDT payment, with the proof already sent (the stored hash) when there is
 * one. The hash is evidence for the team only; it never credits and does not stop the payment from being matched.
 */
function UsdtClaimEntry({ view, token }: { view: CheckoutView; token: string }) {
  const { t } = useTranslation();
  if (!usdtClaimEntry(view)) return null;
  const sent = view.claimedTxHash;
  return (
    <View style={{ gap: 8 }}>
      {sent ? (
        <View testID="usdt-proof" style={{ gap: 6, padding: 16, borderRadius: 14, backgroundColor: color.surface }}>
          <Txt size={14} weight={600}>
            {t("usdt.proofSent")}
          </Txt>
          <Txt font="fig" size={12} lineHeight={18}>
            {shownTxHash(sent, view.network)}
          </Txt>
          <Txt size={13} color={color.ink2}>
            {t("usdt.proofNote")}
          </Txt>
        </View>
      ) : null}
      <Pressable
        testID="pay-claim"
        accessibilityRole="link"
        onPress={() => router.push({ pathname: "/payments/claim/[id]", params: { id: view.id, kind: "usdt", token } })}
        style={{ minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }}
      >
        <Txt size={15} weight={500} color={color.accentText} style={{ textAlign: "center", alignSelf: "stretch" }}>
          {t(sent ? "usdt.updateProof" : "usdt.claimLink")}
        </Txt>
      </Pressable>
    </View>
  );
}
