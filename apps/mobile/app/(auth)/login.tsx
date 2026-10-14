import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { LoginSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { signInWithGoogle } from "@/auth/google";
import { errorText, validationKey } from "@/auth/messages";
import { useSession } from "@/auth/session-store";
import { appConfig } from "@/config";
import { Button, Screen, Txt } from "@/theme/ui";
import { Field, FormScroll, TextLink, formStyles } from "@/ui/form";

const TokenResult = z.object({ token: z.string(), userId: z.string() });

export default function Login() {
  const { t } = useTranslation();
  const signIn = useSession((s) => s.signIn);
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
      await signIn(out.token);
      router.replace("/lock-setup");
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
      const token = await signInWithGoogle();
      if (token) {
        await signIn(token);
        router.replace("/lock-setup");
      }
    } catch (e) {
      setError(errorText(e, t, "auth.googleFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <FormScroll>
        <Txt variant="title">{t("auth.login")}</Txt>
        <Field
          label={t("auth.email")}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Field
          label={t("auth.password")}
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        {error ? <Txt accessibilityRole="alert" style={formStyles.error}>{error}</Txt> : null}
        <Button label={t("auth.login")} onPress={submit} busy={busy} />
        {googleEnabled ? <Button label={t("auth.google")} kind="secondary" onPress={google} disabled={busy} /> : null}
        <TextLink href="/forgot" label={t("auth.forgot")} />
        <TextLink href="/register" label={t("auth.noAccount")} />
      </FormScroll>
    </Screen>
  );
}
