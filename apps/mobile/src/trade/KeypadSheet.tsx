import * as Haptics from "expo-haptics";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { stakePresets, stakeToMinor } from "@asm/client-core";
import { money } from "@/money/format";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { AmountKeypad } from "@/ui/AmountKeypad";
import { Chip } from "@/ui/Chip";
import { DashedRule } from "@/ui/DashedRule";
import { Money } from "@/ui/Money";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { stakeAmountOpts } from "./stake-input";
import { keypadModel } from "./keypad-model";

const light = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/**
 * Cheque-style amount: the figure, the amount in words (INR), quick amounts, what a win pays, a ledger keypad
 * and a white Done (blue is kept for actions that move money). It only reports presses: the owner applies each one
 * to the LATEST saved stake (`stakeAfterKey`), never to the `value` it rendered, so fast presses cannot drop a digit.
 */
export const KeypadSheet = forwardRef<
  SheetRef,
  {
    currency: string;
    accountType: "DEMO" | "LIVE";
    payoutPct: number | null;
    value: string;
    onKey: (key: string) => void;
    onPreset: (text: string) => void;
    onDone: () => void;
  }
>(function KeypadSheet({ currency, accountType, payoutPct, value, onKey, onPreset, onDone }, ref) {
  const { t, i18n } = useTranslation();
  const opts = stakeAmountOpts(currency);
  const { figure, words, winMinor } = keypadModel(value, currency, payoutPct, i18n.language.startsWith("hi") ? "hi" : "en");

  return (
    <Sheet ref={ref} title={t("trade.amount")} aside={t(accountType === "LIVE" ? "trade.liveAccount" : "trade.demoAccount")} flush>
      <View style={{ paddingHorizontal: 20, gap: 4 }}>
        <Money
          text={figure}
          size={46}
          tracking={-0.05}
          lineHeight={56}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={`${t("trade.amount")}: ${figure}`}
          accessibilityLiveRegion="polite"
        />
        {words ? (
          <>
            <DashedRule />
            <Txt size={16} color={color.ink2} style={{ paddingTop: 2 }}>
              {words}
            </Txt>
          </>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 16 }}>
        {stakePresets(currency).map((amount) => (
          <Chip
            key={amount}
            figures
            label={money(stakeToMinor(String(amount)), currency, { trim: true })}
            selected={value === String(amount)}
            onPress={() => {
              light();
              onPreset(String(amount));
            }}
            style={{ flex: 1, paddingHorizontal: 4 }}
          />
        ))}
      </View>

      {payoutPct !== null ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
          {/* The label takes the room the figure leaves (a definite width), so multi-word Hindi wraps instead of clipping. */}
          <Txt size={15} color={color.ink2} style={{ flex: 1 }}>
            {t("trade.ifYouWin", { pct: payoutPct })}
          </Txt>
          {winMinor !== null ? (
            <Money text={money(winMinor, currency)} size={15} weight={600} color={color.up} style={{ flexShrink: 0 }} />
          ) : (
            <Money text="—" size={15} color={color.ink3} style={{ flexShrink: 0 }} />
          )}
        </View>
      ) : (
        <View style={{ height: 16 }} />
      )}

      <AmountKeypad decimals={opts.decimals} onKey={onKey} onClear={() => onPreset("")} />

      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}>
        <Button testID="keypad-done" kind="light" label={t("common.done")} onPress={onDone} />
      </View>
    </Sheet>
  );
});
