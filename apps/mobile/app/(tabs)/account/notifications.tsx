import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { PreferencesSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { registerDevice } from "@/push/push";
import { BackHeader } from "@/ui/BackHeader";
import { useSessionLive } from "@/auth/use-session-live";
import { Button, Card, Screen, Txt } from "@/theme/ui";
import { space } from "@/theme/tokens";

const KEYS = ["notifyTrades", "notifyPayments", "notifyAccount"] as const;

export default function NotificationsSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const live = useSessionLive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [granted, setGranted] = useState<boolean | null>(null);
  const prefs = useQuery({ queryKey: ["prefs"], enabled: live, queryFn: () => api("/api/v1/account/preferences", { schema: PreferencesSchema }) });

  useEffect(() => {
    void Notifications.getPermissionsAsync().then((p) => setGranted(p.status === "granted")).catch(() => {});
  }, []);

  async function toggle(key: (typeof KEYS)[number], value: boolean) {
    if (busy || !live) return;
    setBusy(true); setError(false);
    try {
    const next = await api("/api/v1/account/preferences", { method: "PATCH", body: { [key]: value }, schema: PreferencesSchema });
    qc.setQueryData(["prefs"], next);
    } catch { setError(true); } finally { setBusy(false); }
  }

  return (
    <Screen style={{ padding: space(4), gap: space(3) }}>
      <BackHeader title={t("notifications.title")} />
      {error || prefs.isError ? <Txt>{t("notifications.error")}</Txt> : null}
      {granted === false ? (
        <Card style={{ gap: space(2) }}>
          <Txt>{t("notifications.off")}</Txt>
          <Button
            label={t("notifications.turnOn")}
            onPress={() => {
              void (async () => {
              const res = await Notifications.requestPermissionsAsync();
              if (res.status === "granted") {
                setGranted(true);
                await registerDevice();
              } else void Linking.openSettings();
              })().catch(() => setError(true));
            }}
          />
        </Card>
      ) : null}
      <Card>
        {KEYS.map((k) => (
          <View key={k} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Txt style={{ flex: 1 }}>{t(`notifications.${k}`)}</Txt>
            <Switch accessibilityLabel={t(`notifications.${k}`)} disabled={busy || !prefs.data || !live}
              value={prefs.data?.[k] ?? true} onValueChange={(v) => void toggle(k, v)} />
          </View>
        ))}
      </Card>
      <View />
    </Screen>
  );
}
