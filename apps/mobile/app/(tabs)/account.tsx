import { useTranslation } from "react-i18next";
import { useSession } from "@/auth/session-store";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";

export default function Account() {
  const { t } = useTranslation();
  const signOut = useSession((s) => s.signOut);
  return (
    <Screen style={{ paddingHorizontal: 20, paddingTop: 24, gap: 8 }}>
      <Txt weight={600} size={24} accessibilityRole="header">
        {t("tabs.account")}
      </Txt>
      <Txt size={15} color={color.ink2}>
        {t("tabs.soon")}
      </Txt>
      {/* Placeholder until the account hub lands; lets testers sign out. */}
      <Button label={t("account.logout")} kind="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
