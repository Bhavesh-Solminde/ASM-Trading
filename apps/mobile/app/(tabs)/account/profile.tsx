import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { identityRows, nicknameProblem, NICKNAME_MAX, profileBody, saveEnabled } from "@/account/profile-model";
import { api } from "@/api/client";
import { shouldRefetchOnFocus } from "@/api/focus-refetch";
import { queryClient, useProfile } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSessionLive } from "@/auth/use-session-live";
import { detailsEditable, kycRequestErrorText } from "@/kyc/verify-model";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { FormScroll, Field } from "@/ui/form";
import { KeyValueBox } from "@/ui/KeyValueBox";
import { toast } from "@/ui/Toast";

/** Saving a nickname is idempotent, but a slow answer must not look like a dead button: 15 s, then say so. */
const SAVE_TIMEOUT_MS = 15_000;

/**
 * Profile (R2 "Profile"): the display name (always editable) and the email (read-only), then the identity on file as
 * read-only rows (Aadhaar masked). The identity is edited in the KYC flow, which owns the freeze rule: while a
 * submission is in review or approved the server refuses changes (409) and the screen says so instead of offering them.
 * Save sends the nickname alone; a refusal shows the server's message.
 */
export default function Profile() {
  const { t } = useTranslation();
  const sessionLive = useSessionLive();
  const profile = useProfile(sessionLive);
  const { refetch, dataUpdatedAt } = profile;
  const updatedAt = useRef(dataUpdatedAt);
  updatedAt.current = dataUpdatedAt;
  useFocusEffect(
    useCallback(() => {
      if (shouldRefetchOnFocus({ live: sessionLive, dataUpdatedAt: updatedAt.current, now: Date.now() })) void refetch({ cancelRefetch: false });
    }, [sessionLive, refetch]),
  );

  // `null` until the user types: the field then shows the saved nickname, so no effect has to copy it in.
  const [draft, setDraft] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const data = profile.data;
  const saved = data?.nickname ?? null;
  const value = draft ?? saved ?? "";
  const problemKey = touched ? nicknameProblem(value) : null;

  const save = async () => {
    if (inFlight.current) return;
    setTouched(true);
    if (!saveEnabled(value, saved)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api("/api/account", { method: "PATCH", body: profileBody(value), timeoutMs: SAVE_TIMEOUT_MS });
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      refreshBootstrap(queryClient);
      toast(t("profile.saved"), "up");
    } catch (e) {
      setError(kycRequestErrorText(e, t, "profile.saveTimedOut"));
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen>
      <FormScroll top>
        <View style={{ padding: 20, gap: 20 }}>
          <BackHeader title={t("profile.title")} />
          {data ? (
            <>
              <Txt size={28} weight={600} accessibilityRole="header">
                {t("profile.heading")}
              </Txt>
              <View style={{ gap: 6 }}>
                <Field testID="profile-nickname" label={t("profile.nickname")} value={value} onChangeText={(v) => setDraft(v)} onBlur={() => setTouched(true)} autoComplete="nickname" autoCapitalize="words" maxLength={NICKNAME_MAX} returnKeyType="done" />
                {problemKey ? (
                  <Txt testID="profile-nickname-problem" size={13} color={color.downText} accessibilityLiveRegion="polite">
                    {t(problemKey)}
                  </Txt>
                ) : null}
              </View>
              <Field testID="profile-email" label={t("profile.email")} value={data.email} editable={false} />
              <Txt size={16} weight={600} accessibilityRole="header">
                {t("profile.identityTitle")}
              </Txt>
              <KeyValueBox rows={identityRows(data).map((row) => ({ key: row.id, testID: `profile-${row.id}`, label: t(row.labelKey), value: row.value ?? t("profile.notAdded"), ...(row.value === null ? { valueColor: color.ink3 } : null) }))} />
              {detailsEditable(data.kycStatus) ? (
                <Button testID="profile-edit-identity" kind="secondary" label={t("profile.editIdentity")} onPress={() => router.push("/account/kyc-details")} />
              ) : (
                <Txt testID="profile-identity-locked" size={14} color={color.ink2}>
                  {t("kyc.detailsLocked")}
                </Txt>
              )}
              {error ? (
                <Txt testID="profile-save-error" size={14} color={color.downText} accessibilityLiveRegion="polite">
                  {error}
                </Txt>
              ) : null}
              <Button testID="profile-save" kind="light" label={t("profile.save")} busy={busy} disabled={!saveEnabled(value, saved)} onPress={() => void save()} />
            </>
          ) : profile.isError ? (
            <View style={{ gap: 12 }}>
              <Txt color={color.ink2}>{t("common.genericError")}</Txt>
              <Button testID="profile-retry" label={t("common.retry")} kind="secondary" onPress={() => void refetch()} />
            </View>
          ) : (
            <View accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} style={{ gap: 12 }}>
              <Skeleton height={52} />
              <Skeleton height={52} />
              <Skeleton height={120} />
            </View>
          )}
        </View>
      </FormScroll>
    </Screen>
  );
}
