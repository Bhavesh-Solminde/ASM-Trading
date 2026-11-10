import * as Linking from "expo-linking";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "@/api/queries";
import { openMmkv } from "@/cache/mmkv";
import { appConfig } from "@/config";
import { updatePrompt, updateUrl } from "./update-check";
export function useUpdatePrompt(enabled: boolean) {
  const { t } = useTranslation();
  const cfg = useAppConfig().data;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !cfg) return;
    const { variant, version, apiUrl } = appConfig();
    const store = openMmkv("ixt-update");
    const url = updateUrl(apiUrl, cfg.apkUrl);
    if (
      !url ||
      shown.current === cfg.latestVersion ||
      updatePrompt({
        variant,
        current: version,
        latest: cfg.latestVersion,
        dismissedVersion: store?.getString("dismissed") ?? null,
      }) !== "prompt"
    )
      return;
    shown.current = cfg.latestVersion;
    Alert.alert(
      t("update.title"),
      t("update.body", { version: cfg.latestVersion }),
      [
        {
          text: t("update.later"),
          style: "cancel",
          onPress: () => store?.set("dismissed", cfg.latestVersion),
        },
        {
          text: t("update.now"),
          onPress: () => void Linking.openURL(url).catch(() => {}),
        },
      ],
      { cancelable: false },
    );
  }, [enabled, cfg, t]);
}
