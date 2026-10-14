import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Image, Pressable, Text, View } from "react-native";
import { formatMinor } from "@asm/client-core";
import logo from "../../assets/icon.png";
import { useSocket } from "@/socket/socket-store";
import { color, radius, space } from "@/theme/tokens";
import { toast } from "@/ui/Toast";
import type { AppAccount } from "./accounts";

const TYPES = ["DEMO", "LIVE"] as const;

/**
 * Logo, Demo/Live switch, the active account's balance and a deposit shortcut. Live is greyed (and says why
 * when tapped) unless the user has live access and a live account.
 */
export function TopBar({
  account,
  liveEnabled,
  onSelectType,
}: {
  account: AppAccount;
  liveEnabled: boolean;
  onSelectType: (type: AppAccount["type"]) => void;
}) {
  const { t } = useTranslation();
  const bal = useSocket((s) => s.trades.balances[account.id]) ?? account;
  const total = Math.round(bal.realBalance + bal.bonusBalance);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), height: 52 }}>
      <Image source={logo} accessibilityIgnoresInvertColors style={{ width: 28, height: 28, borderRadius: 6 }} />
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: "row", backgroundColor: color.tile, borderRadius: radius.pill, padding: 2 }}
      >
        {TYPES.map((type) => {
          const selected = account.type === type;
          const blocked = type === "LIVE" && !liveEnabled;
          return (
            <Pressable
              key={type}
              testID={`account-${type.toLowerCase()}`}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: blocked }}
              onPress={() => (blocked ? toast(t("trade.liveLocked")) : onSelectType(type))}
              style={{
                minHeight: 44,
                minWidth: 52,
                paddingHorizontal: 10,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.pill,
                backgroundColor: selected ? color.brandFill : "transparent",
                opacity: blocked ? 0.45 : 1,
              }}
            >
              <Text style={{ color: selected ? color.brandInk : color.ink2, fontWeight: "700", fontSize: 12 }}>
                {type === "DEMO" ? t("trade.demo") : t("trade.live")}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <Text
        accessibilityLabel={`${t("trade.balance")}: ${formatMinor(total, account.currency)}`}
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ color: color.ink, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 1 }}
      >
        {formatMinor(total, account.currency)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("trade.deposit")}
        // The real deposit flow arrives with the payments work; until then this opens the Payments tab.
        onPress={() => router.navigate("/payments")}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color.up, alignItems: "center", justifyContent: "center" }}
      >
        <Text style={{ color: color.upInk, fontSize: 24, fontWeight: "700", lineHeight: 28 }}>+</Text>
      </Pressable>
    </View>
  );
}
