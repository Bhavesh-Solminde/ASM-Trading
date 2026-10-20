import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";

/** Stub: a later P3 task replaces this screen. It exists now so every link to it type-checks. */
export default function Stub() {
  const { t } = useTranslation();
  return (
    <Screen style={{ paddingHorizontal: 20, paddingTop: 24 }}>
      <Txt size={15} color={color.ink2}>
        {t("tabs.soon")}
      </Txt>
    </Screen>
  );
}
