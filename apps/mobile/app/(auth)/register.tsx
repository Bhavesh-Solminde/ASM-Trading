import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RegisterSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { TokenResult, finishSignIn } from "@/auth/finish-sign-in";
import { errorText, validationKey } from "@/auth/messages";
import { Button, Screen, Txt } from "@/theme/ui";
import { Field, FormScroll, TextLink, formStyles } from "@/ui/form";

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
      await finishSignIn(out.token);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <FormScroll>
        <Txt variant="title">{t("auth.register")}</Txt>
        <Field label={t("auth.name")} autoComplete="name" autoCapitalize="words" value={name} onChangeText={setName} />
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
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        <Txt variant="small">{t("auth.passwordHint")}</Txt>
        {error ? <Txt accessibilityRole="alert" style={formStyles.error}>{error}</Txt> : null}
        <Button label={t("auth.register")} onPress={submit} busy={busy} />
        <TextLink href="/login" label={t("auth.haveAccount")} />
      </FormScroll>
    </Screen>
  );
}
