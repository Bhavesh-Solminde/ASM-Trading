import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "@/api/queries";
import { appConfig } from "@/config";
import { useBelowMin } from "@/gate/use-below-min";
import { Button } from "@/theme/ui";
import { GateScreen } from "@/ui/GateScreen";

export default function UpdateRequired() {
  const { t } = useTranslation();
  const cfg = useAppConfig().data;
  const { variant, apiUrl } = appConfig();
  const target = variant === "play" && cfg?.playLive && cfg.playUrl ? cfg.playUrl : `${apiUrl}${cfg?.apkUrl ?? "/download/app"}`;
  // The Gatekeeper decides (useBelowMin, or a server 426) that this screen shows; here the card only displays the
  // two versions. Only when the cached config agrees this version is too old: after a 426 that config can be up
  // to 5 minutes stale and would read "Needed" lower than "You have".
  const belowMin = useBelowMin();
  const needed = belowMin ? cfg?.minVersion : undefined;
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
