import { router } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { KycIdentityField } from "@asm/contracts";
import { api } from "@/api/client";
import { queryClient } from "@/api/queries";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Field } from "@/ui/form";
import { detailsBody, detailsProblems, draftFromProfile, formatDobInput, sanitizeAadhaar, sanitizePan, type DetailsDraft } from "./details-model";
import { kycRequestErrorText } from "./verify-model";

/** Saving is idempotent (a PATCH), but a slow answer must not look like a dead button: 15 s, then say so. */
const SAVE_TIMEOUT_MS = 15_000;

/** A field and its problem line, kept together so the column's gap does not push the message away. */
function Block({ children }: { children: ReactNode }) {
  return <View style={{ gap: 6 }}>{children}</View>;
}

function Problem({ children, testID }: { children: string; testID: string }) {
  return (
    <Txt testID={testID} size={13} color={color.downText} accessibilityLiveRegion="polite">
      {children}
    </Txt>
  );
}

/**
 * The seven KYC identity fields, in `KYC_IDENTITY_FIELDS` order, with the label above each (R2 "Identity details").
 * Nothing is flagged until the first Save tap; after it, each problem shows under its field and clears as it is fixed.
 * Save validates with the server's own schema, sends `PATCH /api/account`, refetches the profile and goes back, so
 * the verify screen shows the next step. Only mounted while the details are editable (NOT_STARTED / REJECTED).
 */
export function DetailsForm({ profile }: { profile: Readonly<Record<KycIdentityField, string | null>> }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DetailsDraft>(() => draftFromProfile(profile));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const set = (field: KycIdentityField, value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const problems = submitted ? detailsProblems(draft, new Date()) : {};
  const problem = (field: KycIdentityField) => {
    const key = problems[field];
    return key ? <Problem testID={`kyc-problem-${field}`}>{t(key)}</Problem> : null;
  };

  const save = async () => {
    if (inFlight.current) return;
    setSubmitted(true);
    if (Object.keys(detailsProblems(draft, new Date())).length > 0) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api("/api/account", { method: "PATCH", body: detailsBody(draft), timeoutMs: SAVE_TIMEOUT_MS });
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      if (router.canGoBack()) router.back();
      else router.replace("/account/verify");
    } catch (e) {
      setError(kycRequestErrorText(e, t, "kyc.saveTimedOut"));
      // A 409 means the submission froze meanwhile: refetch so the screen shows the locked state.
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <Txt size={15} color={color.ink2}>
        {t("kyc.detailsIntro")}
      </Txt>
      <Block>
        <Field testID="kyc-firstName" label={t("kyc.field.firstName")} value={draft.firstName} onChangeText={(v) => set("firstName", v)} autoComplete="given-name" textContentType="givenName" autoCapitalize="words" maxLength={60} />
        {problem("firstName")}
      </Block>
      <Block>
        <Field testID="kyc-lastName" label={t("kyc.field.lastName")} value={draft.lastName} onChangeText={(v) => set("lastName", v)} autoComplete="family-name" textContentType="familyName" autoCapitalize="words" maxLength={60} />
        {problem("lastName")}
      </Block>
      <Block>
        <Field
          testID="kyc-dateOfBirth"
          label={t("kyc.field.dateOfBirth")}
          value={draft.dateOfBirth}
          onChangeText={(v) => set("dateOfBirth", formatDobInput(v))}
          placeholder={t("kyc.placeholder.dateOfBirth")}
          keyboardType="number-pad"
          maxLength={10}
        />
        {problem("dateOfBirth") ?? (
          <Txt size={13} color={color.ink3}>
            {t("kyc.dobHint")}
          </Txt>
        )}
      </Block>
      <Block>
        <Field
          testID="kyc-aadhaar"
          label={t("kyc.field.aadhaar")}
          value={draft.aadhaar}
          onChangeText={(v) => set("aadhaar", sanitizeAadhaar(v))}
          placeholder={t("kyc.placeholder.aadhaar")}
          keyboardType="number-pad"
          maxLength={12}
          autoComplete="off"
        />
        {problem("aadhaar")}
      </Block>
      <Block>
        <Field
          testID="kyc-pan"
          label={t("kyc.field.pan")}
          value={draft.pan}
          onChangeText={(v) => set("pan", sanitizePan(v))}
          placeholder={t("kyc.placeholder.pan")}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          autoComplete="off"
        />
        {problem("pan")}
      </Block>
      <Block>
        <Field
          testID="kyc-address"
          label={t("kyc.field.address")}
          value={draft.address}
          onChangeText={(v) => set("address", v)}
          placeholder={t("kyc.placeholder.address")}
          autoComplete="street-address"
          multiline
          maxLength={240}
        />
        {problem("address")}
      </Block>
      <Block>
        <Field testID="kyc-country" label={t("kyc.field.country")} value={draft.country} onChangeText={(v) => set("country", v)} autoComplete="off" maxLength={60} />
        {problem("country")}
      </Block>
      {error ? (
        <Txt testID="kyc-save-error" size={14} color={color.downText} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      <Button testID="kyc-save" kind="light" label={t("kyc.saveDetails")} busy={busy} onPress={() => void save()} />
    </View>
  );
}
