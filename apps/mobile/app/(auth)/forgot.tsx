import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { PasswordResetRequestSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { validationKey } from "@/auth/messages";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { Wordmark } from "@/ui/Brand";
import { Field, FormScroll, TextLink } from "@/ui/form";
import { Tricolour } from "@/ui/Tricolour";

export default function Forgot() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const parsed = PasswordResetRequestSchema.safeParse({ email: email.trim() });
    if (!parsed.success) return setError(t(validationKey(parsed.error.issues)));
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/password-reset/request", { method: "POST", body: parsed.data, auth: false });
    } catch {
      // Same message whether or not the email exists, or the call failed (matches the website).
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <Screen>
      <FormScroll top>
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          <View>
            <Wordmark width={200} />
            <Tricolour fade width={200} style={{ marginTop: 2 }} />
          </View>
          <Txt weight={600} size={28} tracking={-0.01} accessibilityRole="header">
            {t("auth.forgotTitle")}
          </Txt>
          {sent ? (
            <Txt accessibilityRole="alert" size={16} color={color.ink2}>
              {t("auth.resetSent")}
            </Txt>
          ) : (
            <>
              <Field
                label={t("auth.email")}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={submit}
              />
              {error ? (
                <Txt accessibilityRole="alert" size={14} color={color.downText}>
                  {error}
                </Txt>
              ) : null}
              <Button label={t("auth.sendReset")} onPress={submit} busy={busy} />
            </>
          )}
          <TextLink href="/login" label={t("auth.backToLogin")} />
        </View>
      </FormScroll>
    </Screen>
  );
}
