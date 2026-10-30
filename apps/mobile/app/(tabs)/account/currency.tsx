import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { currencyRows } from "@/account/currency-switch";
import { useCurrencySwitch } from "@/account/useCurrencySwitch";
import { useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { Money } from "@/ui/Money";
import { StatusTag } from "@/ui/StatusTag";

/**
 * Currency (R5 settings rows): one card per account, Demo then Live, each with its balance and currency, a preview of
 * what the whole balance becomes at the fixed ₹100 = $1, and a "Switch to USD / INR" button. The button asks first (an
 * Alert), then sends the money-moving POST (see `useCurrencySwitch`): one at a time, never retried. The server decides
 * what is allowed; a refusal shows its message.
 */
export default function Currency() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);
  const boot = useBootstrap(!!token).data;
  // The socket's balance moves with every trade; the bootstrap's is the fallback.
  const balances = useSocket((s) => s.trades.balances);
  const rows = currencyRows(boot?.accounts, balances);
  const { busyId, confirmSwitch } = useCurrencySwitch();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 20 + insets.bottom }}>
        <BackHeader title={t("currency.title")} />
        <Txt size={14} color={color.ink2}>
          {t("currency.intro")}
        </Txt>
        {boot === undefined ? <Skeleton height={190} /> : null}
        {rows.map((row) => {
          const switching = busyId === row.accountId;
          return (
            <View key={row.accountId} testID={`currency-row-${row.type.toLowerCase()}`} style={{ backgroundColor: color.surface, borderRadius: 14, padding: 16, gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 }}>
                <Txt size={17} weight={600} style={{ flex: 1 }}>
                  {t(row.type === "LIVE" ? "trade.liveAccount" : "trade.demoAccount")}
                </Txt>
                <View style={{ flexShrink: 0 }}>
                  <StatusTag tone="neutral" label={row.currency} testID={`currency-current-${row.type.toLowerCase()}`} />
                </View>
              </View>
              <View style={{ gap: 2 }}>
                <Txt size={14} color={color.ink2}>
                  {t("currency.balance")}
                </Txt>
                <Money text={money(row.totalMinor, row.currency)} size={28} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} />
              </View>
              <Txt testID={`currency-preview-${row.type.toLowerCase()}`} size={14} color={color.ink2}>
                {t("currency.preview", { from: money(row.totalMinor, row.currency), to: money(row.previewMinor, row.next) })}
              </Txt>
              <Button
                testID={`currency-switch-${row.type.toLowerCase()}`}
                kind="secondary"
                label={t("currency.switchTo", { currency: row.next })}
                busy={switching}
                disabled={busyId !== null && !switching}
                onPress={() => confirmSwitch(row)}
              />
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
