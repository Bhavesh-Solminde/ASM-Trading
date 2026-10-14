import { useTranslation } from "react-i18next";
import { useSession } from "@/auth/session-store";
import { space } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";

export default function Account() {
  const { t } = useTranslation();
  const signOut = useSession((s) => s.signOut);
  return (
    <Screen style={{ padding: space(4), gap: space(4) }}>
      <Txt variant="title" accessibilityRole="header">
        {t("tabs.account")}
      </Txt>
      {/* Placeholder until the account hub lands; lets testers sign out. */}
      <Button label={t("account.logout")} kind="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
