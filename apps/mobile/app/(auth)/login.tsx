import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { LoginSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { signInWithGoogle } from "@/auth/google";
import { TokenResult, finishSignIn } from "@/auth/finish-sign-in";
import { errorText, validationKey } from "@/auth/messages";
import { appConfig } from "@/config";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { Wordmark } from "@/ui/Brand";
import { Field, FormScroll, PasswordField, TextLink } from "@/ui/form";
import { LanguageSwitch } from "@/ui/LanguageSwitch";
import { Sparkline } from "@/ui/Sparkline";
import { Tricolour } from "@/ui/Tricolour";

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const googleEnabled = appConfig().googleWebClientId !== "";

  async function submit() {
    if (busy) return;
    const parsed = LoginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) return setError(t(validationKey(parsed.error.issues)));
    setBusy(true);
    setError(null);
    try {
      const out = await api("/api/auth/login", { method: "POST", body: parsed.data, schema: TokenResult, auth: false });
      await finishSignIn(out.token, out.userId);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await signInWithGoogle();
      if (session) await finishSignIn(session.token, session.userId);
    } catch (e) {
      setError(errorText(e, t, "auth.googleFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <FormScroll top>
        <View style={{ paddingHorizontal: 20 }}>
          <Wordmark width={250} />
          <Tricolour fade width={250} style={{ marginTop: 2 }} />
        </View>
        <View style={{ marginTop: 10 }}>
          <Sparkline />
        </View>
        <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 14 }}>
          <Txt weight={600} size={28} tracking={-0.01} accessibilityRole="header">
            {t("auth.login")}
          </Txt>
          <Field
            testID="login-email"
            label={t("auth.email")}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <PasswordField testID="login-password" label={t("auth.password")} autoComplete="password" value={password} onChangeText={setPassword} onSubmitEditing={submit} />
          {error ? (
            <Txt accessibilityRole="alert" size={14} color={color.downText}>
              {error}
            </Txt>
          ) : null}
          <View style={{ marginTop: 4, gap: 10 }}>
            <Button testID="login-submit" label={t("auth.login")} onPress={submit} busy={busy} />
            {googleEnabled ? <Button label={t("auth.google")} kind="secondary" onPress={google} disabled={busy} /> : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
            <TextLink href="/forgot" label={t("auth.forgot")} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Txt size={14} color={color.ink2}>
                {t("auth.newHere")}
              </Txt>
              <TextLink href="/register" label={t("auth.register")} />
            </View>
          </View>
        </View>
        <View style={{ flex: 1 }} />
        <LanguageSwitch />
      </FormScroll>
    </Screen>
  );
}
