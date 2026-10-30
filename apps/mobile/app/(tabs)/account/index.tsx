import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useDemoReset } from "@/account/useDemoReset";
import { demoAccountId, identityInitials, identityName, kycTag, liveCurrency, lockValueKey, showVerifyCard } from "@/account/hub-model";
import { shouldRefetchOnFocus } from "@/api/focus-refetch";
import { useBootstrap, useProfile } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { useSessionLive } from "@/auth/use-session-live";
import { activeLocale } from "@/i18n/locale-sync";
import { useLock } from "@/lock/lock-store";
import { color } from "@/theme/tokens";
import { Button, Card, Screen, Skeleton, Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import { SettingsGroup } from "@/ui/SettingsGroup";
import { SettingsRow } from "@/ui/SettingsRow";
import { StatusTag } from "@/ui/StatusTag";

/**
 * The Account tab: who you are (name, email, KYC stamp), the verify card while there is something to do, and the
 * settings in three groups. The name and stamp come from the profile (`useProfile`), refetched on focus once stale so
 * finishing verification shows here; the bootstrap fills in until it lands.
 */
export default function Account() {
  const { t, i18n } = useTranslation();
  const signOut = useSession((s) => s.signOut);
  const token = useSession((s) => s.token);
  const sessionLive = useSessionLive();
  const query = useBootstrap(!!token);
  const profile = useProfile(sessionLive);
  const lockEnabled = useLock((s) => s.enabled);
  const lockMethod = useLock((s) => s.method);
  const demo = useDemoReset();

  const { refetch, dataUpdatedAt } = profile;
  const updatedAt = useRef(dataUpdatedAt);
  updatedAt.current = dataUpdatedAt;
  useFocusEffect(
    useCallback(() => {
      if (shouldRefetchOnFocus({ live: sessionLive, dataUpdatedAt: updatedAt.current, now: Date.now() })) void refetch({ cancelRefetch: false });
    }, [sessionLive, refetch]),
  );

  const boot = query.data;
  const loaded = profile.data ?? null;
  const email = loaded?.email ?? boot?.profile.email ?? "";
  const name = identityName({ firstName: loaded?.firstName ?? null, lastName: loaded?.lastName ?? null, nickname: loaded?.nickname ?? boot?.profile.nickname ?? null, email });
  const status = loaded?.kycStatus ?? boot?.profile.kycStatus;
  const tag = status ? kycTag(status) : null;
  const tagLabel = tag ? t(tag.labelKey) : "";
  const currency = liveCurrency(boot?.accounts);
  const demoId = demoAccountId(boot?.accounts);

  const confirmLogout = () => {
    Alert.alert(t("account.logoutTitle"), t("account.logoutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("account.logout"), style: "destructive", onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 28 }}>
        <Txt weight={600} size={28} accessibilityRole="header">
          {t("tabs.account")}
        </Txt>
        <Pressable
          testID="account-identity"
          accessibilityRole="button"
          accessibilityLabel={[name, email, tagLabel].filter((s) => s !== "").join(", ")}
          onPress={() => router.push("/account/verify")}
          style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 78 }}
        >
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color.raised, alignItems: "center", justifyContent: "center" }}>
            <Txt size={20} weight={600}>
              {identityInitials(name)}
            </Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            {name !== "" ? (
              <>
                <Txt size={20} weight={600} numberOfLines={1}>
                  {name}
                </Txt>
                <Txt size={14} color={color.ink2} numberOfLines={1}>
                  {email}
                </Txt>
                {tag ? <StatusTag testID="account-kyc-tag" tone={tag.tone} label={tagLabel} /> : null}
              </>
            ) : (
              <Skeleton height={24} />
            )}
          </View>
          <Icon name="chevron" size={18} color={color.ink2} />
        </Pressable>
        {query.isError ? <Button label={t("common.retry")} onPress={() => void query.refetch()} /> : null}
        {status && showVerifyCard(status) ? (
          <Pressable testID="account-verify-card" accessibilityRole="button" onPress={() => router.push("/account/verify")}>
            <Card>
              <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
                <Icon name="lock" size={24} color={color.accentText} />
                <View style={{ flex: 1 }}>
                  <Txt size={16} weight={600}>
                    {t("redesign.verify")}
                  </Txt>
                  <Txt size={12} color={color.ink2}>
                    {t("redesign.verificationHint")}
                  </Txt>
                </View>
                <Icon name="chevron" size={16} color={color.accentText} />
              </View>
            </Card>
          </Pressable>
        ) : null}
        <SettingsGroup title={t("account.groupAccount")}>
          <SettingsRow testID="account-row-profile" icon="user" title={t("account.profile")} onPress={() => router.push("/account/profile")} />
          <SettingsRow testID="account-row-currency" icon="indianRupee" title={t("redesign.currency")} {...(currency ? { value: currency } : null)} onPress={() => router.push("/account/currency")} />
          {demoId ? (
            <SettingsRow testID="account-row-reset-demo" icon="rotateCcw" title={t("account.resetDemo")} {...(demo.busy ? { value: t("common.loading") } : null)} onPress={() => (demo.busy ? undefined : demo.confirmReset(demoId))} />
          ) : null}
        </SettingsGroup>
        <SettingsGroup title={t("account.groupApp")}>
          <SettingsRow testID="account-row-notifications" icon="bell" title={t("redesign.notifications")} onPress={() => router.push("/account/notifications")} />
          <SettingsRow testID="account-row-security" icon="shieldCheck" title={t("redesign.security")} value={t(lockValueKey({ enabled: lockEnabled, method: lockMethod }))} onPress={() => router.push("/account/security")} />
          <SettingsRow testID="account-row-language" icon="languages" title={t("redesign.language")} value={t(activeLocale(i18n.language) === "hi" ? "lang.hi" : "lang.en")} onPress={() => router.push("/account/language")} />
        </SettingsGroup>
        <SettingsGroup title={t("account.groupHelp")}>
          <SettingsRow testID="account-row-support" icon="lifeBuoy" title={t("redesign.support")} onPress={() => router.push("/account/support")} />
        </SettingsGroup>
        <Button testID="account-logout" label={t("account.logout")} kind="text" onPress={confirmLogout} />
      </ScrollView>
    </Screen>
  );
}
