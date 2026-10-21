import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { money, groupTyped } from "@/money/format";
import { amountInWords } from "@/money/words";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { AmountKeypad } from "@/ui/AmountKeypad";
import { Chip } from "@/ui/Chip";
import { Money } from "@/ui/Money";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { DEPOSIT_AMOUNT_OPTS, parseRupees } from "./deposit-form";

/**
 * The deposit amount keypad. The typed amount lives in the SCREEN (the sheet's content mounts only while it is
 * open, so nothing here may hold state worth keeping); this shows `value` and only reports presses, which the
 * screen applies to its latest amount so fast presses cannot drop a digit. Rupees only: no decimal point.
 */
export const AmountSheet = forwardRef<
  SheetRef,
  { value: string; quick: readonly number[]; onKey: (key: string) => void; onPreset: (text: string) => void; onDone?: () => void }
>(function AmountSheet({ value, quick, onKey, onPreset, onDone }, ref) {
  const { t, i18n } = useTranslation();
  const inner = useRef<SheetRef>(null);
  useImperativeHandle(ref, () => ({ present: () => inner.current?.present(), dismiss: () => inner.current?.dismiss() }));
  const rupees = parseRupees(value);
  const figure = `₹ ${groupTyped(value, "INR")}`;
  const words = rupees > 0 ? amountInWords(rupees, i18n.language.startsWith("hi") ? "hi" : "en") : "";
  return (
    <Sheet ref={inner} title={t("deposit.amount")} aside={t("trade.liveAccount")} flush>
      <View style={{ paddingHorizontal: 20, gap: 4 }}>
        <Money text={figure} size={40} weight={600} lineHeight={48} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} accessibilityLabel={`${t("deposit.amount")}: ${figure}`} accessibilityLiveRegion="polite" />
        {words ? (
          <Txt size={14} color={color.ink2}>
            {words}
          </Txt>
        ) : null}
      </View>

      {quick.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 }}>
          {quick.map((amount) => (
            <Chip
              key={amount}
              testID={`deposit-quick-${amount}`}
              figures
              label={money(amount * 100, "INR", { trim: true })}
              selected={rupees === amount}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onPreset(String(amount));
              }}
              style={{ flex: 1, paddingHorizontal: 4 }}
            />
          ))}
        </View>
      ) : (
        <View style={{ minHeight: 16 }} />
      )}

      <AmountKeypad decimals={DEPOSIT_AMOUNT_OPTS.decimals} onKey={onKey} onClear={() => onPreset("")} />

      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}>
        <Button
          testID="keypad-done"
          kind="light"
          label={t("common.done")}
          onPress={() => {
            inner.current?.dismiss();
            onDone?.();
          }}
        />
      </View>
    </Sheet>
  );
});
