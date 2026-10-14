import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PasswordResetRequestSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { validationKey } from "@/auth/messages";
import { Button, Screen, Txt } from "@/theme/ui";
import { Field, FormScroll, TextLink, formStyles } from "@/ui/form";

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
      <FormScroll>
        <Txt variant="title">{t("auth.forgotTitle")}</Txt>
        {sent ? (
          <Txt accessibilityRole="alert">{t("auth.resetSent")}</Txt>
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
            {error ? <Txt accessibilityRole="alert" style={formStyles.error}>{error}</Txt> : null}
            <Button label={t("auth.sendReset")} onPress={submit} busy={busy} />
          </>
        )}
        <TextLink href="/login" label={t("auth.backToLogin")} />
      </FormScroll>
    </Screen>
  );
}
