import { router, type Href } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSession } from "@/auth/session-store";
import { useBootstrap } from "@/api/queries";
import { color } from "@/theme/tokens";
import { Button, Card, Screen, Skeleton, Txt } from "@/theme/ui";
import { Icon, type IconName } from "@/ui/Icon";
const ROWS: { key: string; icon: IconName; route: Href }[] = [
  { key: "security", icon: "lock", route: "/account/security" },
  { key: "language", icon: "user", route: "/account/language" },
  { key: "currency", icon: "wallet", route: "/account/currency" },
  { key: "notifications", icon: "history", route: "/account/notifications" },
  { key: "support", icon: "user", route: "/account/support" },
];
export default function Account() {
  const { t, i18n } = useTranslation();
  const signOut = useSession(s => s.signOut);
  const token = useSession(s => s.token);
  const query = useBootstrap(!!token);
  const profile = query.data?.profile;
  const name = profile?.nickname || profile?.email || "";
  return <Screen><ScrollView contentContainerStyle={{ padding: 20, gap: 28 }}>
    <Txt weight={600} size={28} accessibilityRole="header">{t("tabs.account")}</Txt>
    <Pressable accessibilityRole="button" accessibilityLabel={t("redesign.profile")} onPress={() => router.push("/account/profile")} style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 78 }}>
      <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: color.raised, alignItems: "center", justifyContent: "center" }}><Txt size={22}>{name.slice(0, 2).toUpperCase()}</Txt></View>
      <View style={{ flex: 1 }}>{profile ? <><Txt size={21} weight={600} numberOfLines={1}>{name}</Txt><Txt size={12} color={color.ink2}>{t("redesign.profile")}</Txt></> : <Skeleton height={24} />}</View><Icon name="chevron" size={18} color={color.ink2} />
    </Pressable>
    {query.isError ? <Button label={t("common.retry")} onPress={() => void query.refetch()} /> : null}
    {profile && profile.kycStatus !== "VERIFIED" ? <Pressable accessibilityRole="button" onPress={() => router.push("/account/verify")}><Card><View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}><Icon name="lock" size={24} color={color.accentText} /><View style={{ flex: 1 }}><Txt size={16} weight={600}>{t("redesign.verify")}</Txt><Txt size={12} color={color.ink2}>{t("redesign.verificationHint")}</Txt></View><Icon name="chevron" size={16} color={color.accentText} /></View></Card></Pressable> : null}
    <View><Txt size={12} color={color.ink3} style={{ marginBottom: 12 }}>{t("redesign.preferences")}</Txt>{ROWS.map(row => <Pressable key={row.key} accessibilityRole="button" onPress={() => router.push(row.route)} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: color.rule }}><Icon name={row.icon} size={18} color={color.ink2} /><Txt style={{ flex: 1 }}>{t(`redesign.${row.key}`)}</Txt>{row.key === "language" ? <Txt size={12} color={color.ink2} style={{ flexShrink: 0 }}>{t(i18n.language.startsWith("hi") ? "lang.hi" : "lang.en")}</Txt> : null}<Icon name="chevron" size={16} color={color.ink3} /></Pressable>)}</View>
    <Button label={t("account.logout")} kind="text" onPress={() => void signOut()} />
  </ScrollView></Screen>;
}
