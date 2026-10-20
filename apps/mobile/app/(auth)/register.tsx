import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { RegisterSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { TokenResult, finishSignIn } from "@/auth/finish-sign-in";
import { errorText, validationKey } from "@/auth/messages";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { Wordmark } from "@/ui/Brand";
import { Field, FormScroll, PasswordField, TextLink } from "@/ui/form";
import { Tricolour } from "@/ui/Tricolour";

export default function Register() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const parsed = RegisterSchema.safeParse({ name: name.trim(), email: email.trim(), password });
    if (!parsed.success) return setError(t(validationKey(parsed.error.issues)));
    setBusy(true);
    setError(null);
    try {
      const out = await api("/api/auth/register", { method: "POST", body: parsed.data, schema: TokenResult, auth: false });
      await finishSignIn(out.token, out.userId);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
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
            {t("auth.register")}
          </Txt>
          <Field label={t("auth.name")} autoComplete="name" autoCapitalize="words" value={name} onChangeText={setName} />
          <Field label={t("auth.email")} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <PasswordField label={t("auth.password")} autoComplete="new-password" value={password} onChangeText={setPassword} onSubmitEditing={submit} />
          <Txt size={13} color={color.ink3}>
            {t("auth.passwordHint")}
          </Txt>
          {error ? (
            <Txt accessibilityRole="alert" size={14} color={color.downText}>
              {error}
            </Txt>
          ) : null}
          <Button label={t("auth.register")} onPress={submit} busy={busy} />
          <TextLink href="/login" label={t("auth.haveAccount")} />
        </View>
      </FormScroll>
    </Screen>
  );
}
