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
  return (
    <GateScreen title={t("gate.updateTitle")} body={t("gate.updateBody")}>
      <Button label={t("gate.update")} onPress={() => void Linking.openURL(target).catch(() => {})} />
    </GateScreen>
  );
}
