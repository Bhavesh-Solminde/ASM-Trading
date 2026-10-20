import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "@/api/queries";
import { appConfig } from "@/config";
import { Button } from "@/theme/ui";
import { GateScreen } from "@/ui/GateScreen";

export default function UpdateRequired() {
  const { t } = useTranslation();
  const cfg = useAppConfig().data;
  const { variant, apiUrl } = appConfig();
  const target = variant === "play" && cfg?.playLive && cfg.playUrl ? cfg.playUrl : `${apiUrl}${cfg?.apkUrl ?? "/download/app"}`;
  // The Gatekeeper decides (useBelowMin) that this screen shows; here the card only displays the two versions.
  const needed = cfg?.minVersion;
  return (
    <GateScreen
      title={t("gate.updateTitle")}
      body={t("gate.updateBody")}
      info={needed ? [{ label: t("gate.youHave"), value: appConfig().version }, { label: t("gate.needed"), value: needed, strong: true }] : undefined}
    >
      <Button label={t("gate.update")} icon="download" onPress={() => void Linking.openURL(target).catch(() => {})} />
    </GateScreen>
  );
}
