import { router } from "expo-router";
import { forwardRef, useRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { color, radius, space } from "@/theme/tokens";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { Button } from "@/theme/ui";
import { nextBonus, type BonusTierState } from "./markets";

const BADGE: Record<BonusTierState, { bg: string; ink: string }> = {
  claimed: { bg: color.tile, ink: color.ink3 },
  next: { bg: color.up, ink: color.upInk },
  upcoming: { bg: color.tile, ink: color.ink2 },
};

/** Every deposit bonus tier with the user's progress, plus a shortcut to deposit. Wording matches the web ("Bonus"). */
export const BonusSheet = forwardRef<SheetRef, { completedDeposits: number }>(function BonusSheet({ completedDeposits }, ref) {
  const { t } = useTranslation();
  const inner = useRef<SheetRef>(null);
  useImperativeHandle(ref, () => ({
    present: () => inner.current?.present(),
    dismiss: () => inner.current?.dismiss(),
  }));
  const { pct, tiers } = nextBonus(completedDeposits);
  return (
    <Sheet ref={inner} title={t("bonus.title")}>
      <Text style={{ color: color.ink2, fontSize: 13 }}>{t("bonus.subtitle", { n: tiers.length })}</Text>
      <View accessibilityRole="list" style={{ gap: space(2) }}>
        {tiers.map((tier) => {
          const badge = BADGE[tier.state];
          return (
            <View
              key={tier.n}
              accessibilityLabel={`${t(`bonus.nth${tier.n}`, { defaultValue: t("bonus.nthN", { n: tier.n }) })}, ${tier.pct}%, ${t(`bonus.${tier.state}`)}`}
              accessible
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space(3),
                minHeight: 52,
                paddingHorizontal: space(3),
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: tier.state === "next" ? color.up : color.rule,
                backgroundColor: tier.state === "next" ? color.tileHi : color.tile,
                opacity: tier.state === "claimed" ? 0.7 : 1,
              }}
            >
              <Text style={{ color: tier.state === "claimed" ? color.ink3 : color.up, fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
                {tier.pct}%
              </Text>
              <Text style={{ flex: 1, color: color.ink, fontSize: 14, fontWeight: "600" }}>
                {t(`bonus.nth${tier.n}`, { defaultValue: t("bonus.nthN", { n: tier.n }) })}
              </Text>
              <View style={{ backgroundColor: badge.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Text style={{ color: badge.ink, fontSize: 11, fontWeight: "700" }}>{t(`bonus.${tier.state}`)}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={{ color: color.ink3, fontSize: 11, lineHeight: 16 }}>{t("bonus.note")}</Text>
      {pct > 0 ? (
        <Button
          kind="up"
          label={t("bonus.depositNow", { pct })}
          onPress={() => {
            inner.current?.dismiss();
            router.navigate("/payments");
          }}
        />
      ) : (
        <Text style={{ color: color.ink2, textAlign: "center" }}>{t("bonus.allUsed")}</Text>
      )}
    </Sheet>
  );
});
