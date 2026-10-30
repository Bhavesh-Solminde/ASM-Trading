import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api/client";
import { shouldRefetchOnFocus } from "@/api/focus-refetch";
import { queryClient, useProfile } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSessionLive } from "@/auth/use-session-live";
import { StepCards } from "@/kyc/StepCards";
import { detailsComplete, nextKycStep, type KycDocKind } from "@/kyc/kyc-flow";
import { cardPress, kycRequestErrorText, stepCta, verifyCards, verifyPhase, type StepAction, type VerifyCard } from "@/kyc/verify-model";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { StatusTag } from "@/ui/StatusTag";

/** Submitting is not money-moving, but a second tap after a slow answer would hit the server's 409: one tap at a time. */
const SUBMIT_TIMEOUT_MS = 15_000;

/** A card with a status tag, a title and what it means: the in-review, verified and rejected states. */
function StatusCard({ tone, tag, title, children, testID }: { tone: "up" | "caution" | "down"; tag: string; title: string; children?: ReactNode; testID: string }) {
  return (
    <View testID={testID} style={{ backgroundColor: color.surface, borderRadius: 14, padding: 16, gap: 10 }}>
      <StatusTag tone={tone} label={tag} />
      <Txt size={20} weight={600} accessibilityRole="header">
        {title}
      </Txt>
      {children}
    </View>
  );
}

/**
 * Verify identity: where a user is in KYC and what to do next. Four steps (details, Aadhaar front and back, PAN,
 * selfie) then "Submit for review"; the server's profile (`kycDocuments`, the identity fields, `kycStatus`) says
 * where they are, so the screen has no step state of its own. PENDING and VERIFIED are final cards: the details and
 * photos are frozen on the server (409), so nothing is offered to change. REJECTED shows the reason, and "Start
 * again" opens the steps with everything already on file. The route is `/account/verify` (Withdraw and Payments link to it).
 */
export default function Verify() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const sessionLive = useSessionLive();
  const profile = useProfile(sessionLive);
  const [restarted, setRestarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  // A photo or the details were just saved on another screen (which refetches the profile itself), or the admin
  // decided meanwhile: refetch on focus once the data is stale, and on pull-to-refresh.
  const { refetch, dataUpdatedAt } = profile;
  const updatedAt = useRef(dataUpdatedAt);
  updatedAt.current = dataUpdatedAt;
  useFocusEffect(
    useCallback(() => {
      if (shouldRefetchOnFocus({ live: sessionLive, dataUpdatedAt: updatedAt.current, now: Date.now() })) void refetch({ cancelRefetch: false });
    }, [sessionLive, refetch]),
  );

  const header = <BackHeader title={t("kyc.title")} />;
  const data = profile.data;
  if (!data) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 20 }}>
          {header}
          {profile.isError ? (
            <View style={{ gap: 12 }}>
              <Txt color={color.ink2}>{t("common.genericError")}</Txt>
              <Button testID="verify-retry" label={t("common.retry")} kind="secondary" onPress={() => void refetch()} />
            </View>
          ) : (
            <View accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} style={{ gap: 12 }}>
              <Skeleton height={24} />
              <Skeleton height={300} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  const phase = verifyPhase(data.kycStatus, restarted);
  const state = { detailsComplete: detailsComplete(data), kycDocuments: data.kycDocuments };
  const step = nextKycStep(state);
  const cta = stepCta(step);
  const note = data.kycReviewNote?.trim() ? data.kycReviewNote.trim() : null;

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/kyc/submit", { method: "POST", timeoutMs: SUBMIT_TIMEOUT_MS });
    } catch (e) {
      setError(kycRequestErrorText(e, t, "kyc.submitTimedOut"));
    } finally {
      // Success, a 409 (already in review) and a timeout (it may have gone through) all end with a look at the server.
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      refreshBootstrap(queryClient);
      inFlight.current = false;
      setBusy(false);
    }
  };

  const capture = (kind: KycDocKind) => router.push({ pathname: "/account/kyc-camera", params: { kind } });
  const run = (action: StepAction) => {
    if (action.type === "details") router.push("/account/kyc-details");
    else if (action.type === "capture") capture(action.kind);
    else void submit();
  };
  const onCard = (card: VerifyCard) => {
    const press = cardPress(card.id, card.state, data.kycDocuments);
    if (press.type === "details") router.push("/account/kyc-details");
    else if (press.type === "capture") capture(press.kind);
    else if (press.type === "chooseSide") {
      Alert.alert(t("kyc.chooseSide"), undefined, [
        { text: t("kyc.doc.AADHAAR_FRONT"), onPress: () => capture("AADHAAR_FRONT") },
        { text: t("kyc.doc.AADHAAR_BACK"), onPress: () => capture("AADHAAR_BACK") },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const rejection = (
    <StatusCard testID="verify-rejected" tone="down" tag={t("kyc.rejected")} title={t("kyc.rejectedBody")}>
      {note ? (
        <Txt size={15} color={color.ink} testID="verify-review-note">
          {t("kyc.reason", { note })}
        </Txt>
      ) : null}
      <Txt size={14} color={color.ink2}>
        {t("kyc.rejectedFix")}
      </Txt>
    </StatusCard>
  );

  let body: ReactNode;
  let footer: ReactNode = null;
  if (phase === "verified") {
    body = (
      <StatusCard testID="verify-verified" tone="up" tag={t("kyc.verified")} title={t("kyc.verifiedBody")} />
    );
    footer = <Button testID="verify-withdraw" kind="light" label={t("withdraw.title")} onPress={() => router.push("/payments/withdraw")} />;
  } else if (phase === "pending") {
    body = (
      <StatusCard testID="verify-pending" tone="caution" tag={t("kyc.pending")} title={t("kyc.pendingTitle")}>
        <Txt size={15} color={color.ink2}>
          {t("kyc.pendingBody")}
        </Txt>
      </StatusCard>
    );
  } else if (phase === "rejected") {
    body = rejection;
    footer = <Button testID="verify-start-again" kind="light" label={t("kyc.startAgain")} onPress={() => setRestarted(true)} />;
  } else {
    body = (
      <>
        {data.kycStatus === "REJECTED" ? rejection : null}
        <Txt size={16} color={color.ink2}>
          {t("kyc.intro")}
        </Txt>
        <StepCards cards={verifyCards(state)} onPress={onCard} />
      </>
    );
    footer = (
      <View style={{ gap: 10 }}>
        {error ? (
          <Txt testID="verify-error" size={14} color={color.downText} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        ) : null}
        <Button testID="verify-cta" kind="light" label={t(cta.labelKey)} busy={busy} onPress={() => run(cta.action)} />
      </View>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>{header}</View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={color.ink2} colors={[color.accent]} progressBackgroundColor={color.raised} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 20 }}
        >
          {body}
        </ScrollView>
        {footer ? <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 + insets.bottom }}>{footer}</View> : null}
      </View>
    </Screen>
  );
}
