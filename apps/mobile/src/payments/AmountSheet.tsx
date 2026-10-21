import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { currencySymbol } from "@asm/client-core";
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
 * The amount keypad of the Add money and Withdraw screens. The typed amount lives in the SCREEN (the sheet's content
 * mounts only while it is open, so nothing here may hold state worth keeping); this shows `value` and only reports
 * presses, which the screen applies to its latest amount so fast presses cannot drop a digit. On INR (the default) it
 * is whole rupees with no decimal point and the amount in words; another currency (a USD live account) takes cents.
 * `quick` presets are whole rupees, so they are only for INR.
 */
export const AmountSheet = forwardRef<
  SheetRef,
  {
    value: string;
    quick: readonly number[];
    onKey: (key: string) => void;
    onPreset: (text: string) => void;
    onDone?: () => void;
    currency?: string;
    /** The sheet's heading; defaults to the deposit screen's "Amount". */
    title?: string;
  }
>(function AmountSheet({ value, quick, onKey, onPreset, onDone, currency = "INR", title }, ref) {
  const { t, i18n } = useTranslation();
  const inner = useRef<SheetRef>(null);
  useImperativeHandle(ref, () => ({ present: () => inner.current?.present(), dismiss: () => inner.current?.dismiss() }));
  const inr = currency === "INR";
  const rupees = inr ? parseRupees(value) : 0;
  const heading = title ?? t("deposit.amount");
  const figure = `${currencySymbol(currency)} ${groupTyped(value, currency)}`.trim();
  const words = rupees > 0 ? amountInWords(rupees, i18n.language.startsWith("hi") ? "hi" : "en") : "";
  return (
    <Sheet ref={inner} title={heading} aside={t("trade.liveAccount")} flush>
      <View style={{ paddingHorizontal: 20, gap: 4 }}>
        <Money text={figure} size={40} weight={600} lineHeight={48} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} accessibilityLabel={`${heading}: ${figure}`} accessibilityLiveRegion="polite" />
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

      <AmountKeypad decimals={inr ? DEPOSIT_AMOUNT_OPTS.decimals : true} onKey={onKey} onClear={() => onPreset("")} />

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
