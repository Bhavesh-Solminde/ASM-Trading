import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { queryClient, useCheckout } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { useSessionLive } from "@/auth/use-session-live";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { Field, FormScroll } from "@/ui/form";
import { KeyValueBox, type KeyValueRow } from "@/ui/KeyValueBox";
import { toast } from "@/ui/Toast";
import { CLAIM_TIMEOUT_MS } from "./claim-submit";
import { amountText, requestedAmount } from "./result-model";
import { sanitizeTxHash, shownTxHash, txHashHelp, usdtClaimAvailable } from "./usdt-claim";
import { createUsdtClaimSubmitter } from "./usdt-claim-submit";
import { networkLabel, networkNote } from "./usdt-display";

/**
 * "Submit your transaction": the transaction hash of a USDT payment the watcher did not match (a different amount, or
 * sent after the timer). It is evidence for the team to match by hand: it never credits and never changes the
 * deposit's status. `POST /api/deposits/:id/usdt-claim` is a money-moving call: 15s timeout, one tap at a time, never
 * retried. The deposit's own details (amount, network, address, a hash already sent) come from the checkout the pay
 * screen already loaded, read by `token`; without one the form still works from the deposit id alone.
 */
export function UsdtClaimForm({ depositId, token }: { depositId: string; token: string }) {
  const { t } = useTranslation();
  const sessionLive = useSessionLive();
  const view = useCheckout(token, sessionLive && token !== "").data;
  const [hash, setHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const network = view?.network ?? null;
  const help = txHashHelp(network);

  // Built once (its in-flight flag must survive re-renders); it reads the latest values from here.
  const latest = useRef({ t, depositId, network });
  latest.current = { t, depositId, network };
  const submitter = useRef<ReturnType<typeof createUsdtClaimSubmitter> | null>(null);
  if (submitter.current === null) {
    submitter.current = createUsdtClaimSubmitter({
      post: (body) => api(`/api/deposits/${encodeURIComponent(latest.current.depositId)}/usdt-claim`, { method: "POST", body, timeoutMs: CLAIM_TIMEOUT_MS }),
      refreshCheckout: () => void queryClient.invalidateQueries({ queryKey: ["checkout"] }),
      leave: () => (router.canGoBack() ? router.back() : router.replace("/payments")),
      setError,
      toast,
      session: () => useSession.getState().token,
      setBusy,
      network: () => latest.current.network,
      t: (key, options) => latest.current.t(key, options),
    });
  }

  const closed = view !== undefined && !usdtClaimAvailable(view.status);
  const note = networkNote(network);
  const rows: KeyValueRow[] = [];
  if (view) {
    const asked = requestedAmount(view);
    rows.push({ key: "amount", label: t("usdtClaim.reserved"), value: amountText(asked.minor, asked.currency), testID: "usdt-claim-amount" });
    rows.push({ key: "network", label: t("usdtClaim.network"), value: networkLabel(network), testID: "usdt-claim-network" });
    if (view.receivingAddress) rows.push({ key: "address", label: t("usdtClaim.address"), value: view.receivingAddress, font: "fig", testID: "usdt-claim-address" });
  }

  return (
    <Screen>
      <FormScroll top>
        <View style={{ padding: 20, gap: 20 }}>
          <BackHeader title={t("usdtClaim.title")} />
          {closed ? (
            <View style={{ gap: 16 }}>
              <Txt testID="usdt-claim-closed" accessibilityLiveRegion="polite" size={15} color={color.ink2}>
                {t(view.status === "COMPLETED" ? "usdtClaim.alreadyCredited" : "usdtClaim.closed")}
              </Txt>
              <Button kind="light" label={t("pay.backToPayments")} onPress={() => router.replace("/payments")} />
            </View>
          ) : (
            <>
              {rows.length > 0 ? <KeyValueBox rows={rows} /> : null}
              {view && note.lookalike ? (
                <View accessibilityRole="alert" style={{ gap: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: color.downText, backgroundColor: color.warnBg }}>
                  <Txt size={15} weight={600} color={color.downText}>
                    {t("usdt.sendOnly", { network: networkLabel(network) })}
                  </Txt>
                </View>
              ) : null}
              {view?.claimedTxHash ? (
                <View testID="usdt-claim-existing" style={{ gap: 6, padding: 16, borderRadius: 14, backgroundColor: color.surface }}>
                  <Txt size={14} weight={600}>
                    {t("usdt.proofSent")}
                  </Txt>
                  <Txt font="fig" size={12} lineHeight={18}>
                    {shownTxHash(view.claimedTxHash, network)}
                  </Txt>
                  <Txt size={13} color={color.ink2}>
                    {t("usdtClaim.existingNote")}
                  </Txt>
                </View>
              ) : null}
              <View style={{ gap: 8 }}>
                <Field
                  testID="usdt-claim-hash"
                  label={t("usdtClaim.label")}
                  value={hash}
                  onChangeText={(text) => {
                    setHash(sanitizeTxHash(text));
                    if (error) setError(null);
                  }}
                  placeholder={t(help.placeholder)}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!busy}
                  returnKeyType="done"
                  onSubmitEditing={() => void submitter.current?.(hash)}
                />
                {error ? (
                  <Txt testID="usdt-claim-error" accessibilityLiveRegion="polite" size={13} color={color.downText}>
                    {error}
                  </Txt>
                ) : null}
                <Txt size={13} color={color.ink2}>
                  {t(help.hint)}
                </Txt>
                <Txt size={13} color={color.ink2}>
                  {t("usdtClaim.help")}
                </Txt>
              </View>
              {/* FormScroll pads the bottom inset (or the keyboard), so the button never sits under the navigation bar. */}
              <View style={{ paddingTop: 8, paddingBottom: 8 }}>
                <Button testID="usdt-claim-submit" kind="light" label={t(view?.claimedTxHash ? "usdtClaim.update" : "usdtClaim.submit")} busy={busy} onPress={() => void submitter.current?.(hash)} />
              </View>
            </>
          )}
        </View>
      </FormScroll>
    </Screen>
  );
}
