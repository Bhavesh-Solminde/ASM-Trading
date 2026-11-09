import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { invalidateMoney, queryClient } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { Field, FormScroll } from "@/ui/form";
import { toast } from "@/ui/Toast";
import { CLAIM_TIMEOUT_MS, createClaimSubmitter } from "./claim-submit";
import { sanitizeUtr } from "./utr";

/**
 * "Add UTR": the reference from the user's payment app, for a payment the automatic match has not found. The UTR
 * alone (no screenshot). `POST /api/deposits/:id/claim` is a money-moving call: 15s timeout, one tap at a time,
 * never retried. On success (or when the matcher already settled it) it goes back to the pay screen, which shows
 * what happened.
 */
export function ClaimForm({ depositId }: { depositId: string }) {
  const { t } = useTranslation();
  const [utr, setUtr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Built once (its in-flight flag must survive re-renders); it reads the latest `t` from here.
  const latest = useRef({ t, depositId });
  latest.current = { t, depositId };
  const submitter = useRef<ReturnType<typeof createClaimSubmitter> | null>(null);
  if (submitter.current === null) {
    submitter.current = createClaimSubmitter({
      post: (body) => api(`/api/deposits/${encodeURIComponent(latest.current.depositId)}/claim`, { method: "POST", body, timeoutMs: CLAIM_TIMEOUT_MS }),
      invalidateMoney,
      refreshCheckout: () => void queryClient.invalidateQueries({ queryKey: ["checkout"] }),
      leave: () => (router.canGoBack() ? router.back() : router.replace("/payments")),
      setError,
      toast,
      session: () => useSession.getState().token,
      setBusy,
      t: (key, options) => latest.current.t(key, options),
    });
  }

  return (
    <Screen>
      <FormScroll top>
        <View style={{ padding: 20, gap: 20 }}>
          <BackHeader title={t("claim.title")} />
          <View style={{ gap: 8 }}>
            <Field
              testID="claim-utr"
              label={t("claim.utr")}
              value={utr}
              onChangeText={(text) => {
                setUtr(sanitizeUtr(text));
                if (error) setError(null);
              }}
              placeholder={t("claim.placeholder")}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={40}
              autoComplete="off"
              autoCorrect={false}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={() => void submitter.current?.(utr)}
            />
            {error ? (
              <Txt testID="claim-error" accessibilityLiveRegion="polite" size={13} color={color.downText}>
                {error}
              </Txt>
            ) : null}
            <Txt size={13} color={color.ink2}>
              {t("claim.help")}
            </Txt>
          </View>
          {/* FormScroll pads the bottom inset (or the keyboard), so the button never sits under the navigation bar. */}
          <View style={{ paddingTop: 8, paddingBottom: 8 }}>
            <Button testID="claim-submit" kind="light" label={t("claim.submit")} busy={busy} onPress={() => void submitter.current?.(utr)} />
          </View>
        </View>
      </FormScroll>
    </Screen>
  );
}
