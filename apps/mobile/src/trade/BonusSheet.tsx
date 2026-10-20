import { router } from "expo-router";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { LedgerHeader, LedgerRow, type LedgerColumn } from "@/ui/Ledger";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { Stamp } from "@/ui/Stamp";
import { nextBonus } from "./markets";

const COLS: LedgerColumn[] = [{ flex: 1 }, { width: 80, align: "right" }, { width: 96, align: "right" }];

/**
 * The bonus rules as a small table, gold only on the next tier; the withdrawal rule stays in words above the
 * button. The tiers (100, 100, 50, 50) come from client-core's BONUS_TIERS through `nextBonus`, so the app
 * can never disagree with the server about them.
 */
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
      <Txt size={15} color={color.ink2}>
        {t("bonus.subtitle", { n: tiers.length })}
      </Txt>
      <View accessibilityRole="list">
        <LedgerHeader columns={COLS} labels={[t("bonus.colDeposit"), t("bonus.colBonus"), t("bonus.colStatus")]} />
        {tiers.map((tier) => {
          const nth = t(`bonus.nth${tier.n}`, { defaultValue: t("bonus.nthN", { n: tier.n }) });
          const state = t(`bonus.${tier.state}`);
          const next = tier.state === "next";
          return (
            <LedgerRow
              key={tier.n}
              columns={COLS}
              accessibilityLabel={`${nth}, ${tier.pct}%, ${state}`}
              cells={[
                <Txt key="n" weight={600} size={16} color={tier.state === "claimed" ? color.ink3 : color.ink}>
                  {nth}
                </Txt>,
                <Txt key="pct" font="fig" weight={next ? 600 : 500} size={15} color={next ? color.gold : tier.state === "claimed" ? color.ink3 : color.ink}>
                  {`${tier.pct}%`}
                </Txt>,
                next ? (
                  <Stamp key="state" label={state} tone="gold" />
                ) : tier.state === "claimed" ? (
                  <Stamp key="state" label={state} tone="muted" />
                ) : (
                  <Txt key="state" size={14} color={color.ink3}>
                    {state}
                  </Txt>
                ),
              ]}
            />
          );
        })}
      </View>
      <Txt size={14} color={color.ink2}>
        {t("bonus.note")}
      </Txt>
      {pct > 0 ? (
        <Button
          label={t("trade.deposit")}
          onPress={() => {
            inner.current?.dismiss();
            router.navigate("/payments/deposit");
          }}
        />
      ) : (
        <Txt color={color.ink2} style={{ textAlign: "center" }}>
          {t("bonus.allUsed")}
        </Txt>
      )}
    </Sheet>
  );
});
