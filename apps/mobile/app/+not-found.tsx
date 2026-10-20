import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/theme/ui";
import { GateScreen } from "@/ui/GateScreen";

/**
 * Any path no route matches (a stray deep link, a notification aimed at a screen this build lacks) lands here
 * instead of expo-router's built-in page, which lists every route in the app. The one action goes to "/", which
 * the gatekeeper owns: it sends a signed-out, locked or gated user to the right gate, and everyone else to Trade.
 */
export default function NotFound() {
  const { t } = useTranslation();
  return (
    <GateScreen title={t("gate.notFoundTitle")} body={t("gate.notFoundBody")}>
      <Button label={t("gate.notFound")} onPress={() => router.replace("/")} />
    </GateScreen>
  );
}
