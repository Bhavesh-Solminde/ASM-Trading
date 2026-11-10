import * as LocalAuth from "expo-local-authentication";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLock } from "@/lock/lock-store";
import { PinBoxes } from "@/lock/PinBoxes";
import { biometricLabelKey } from "@/lock/biometric-label";
import { PinPad } from "@/lock/PinPad";
import { isValidPin } from "@/lock/pin";
import { color, radius } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { Icon, type IconName } from "@/ui/Icon";

/** One tappable card row: tinted icon tile, title + hint, chevron. 70pt tall with its padding, so well over 44. */
function OptionRow({
  icon,
  tone,
  title,
  hint,
  onPress,
  disabled,
  testID,
  last,
}: {
  icon: IconName;
  tone: "accent" | "muted";
  title: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  last?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${hint}`}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: color.ruleSoft,
        backgroundColor: pressed ? color.raised : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{ width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: tone === "accent" ? color.accentDim : color.raised }}>
        <Icon name={icon} size={22} color={tone === "accent" ? color.accentText : color.ink2} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight={600} size={17}>
          {title}
        </Txt>
        <Txt size={14} color={color.ink3}>
          {hint}
        </Txt>
      </View>
      <Icon name="chevron" size={18} strokeWidth={2} color={color.ink3} />
    </Pressable>
  );
}

export default function LockSetup() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { enableBiometric, setPin, skipSetup } = useLock();
  const [step, setStep] = useState<"choose" | "pin" | "confirm">("choose");
  const [biometric, setBiometric] = useState(false);
  const [bioLabelKey, setBioLabelKey] = useState<ReturnType<typeof biometricLabelKey>>("lock.useBiometric");
  const [first, setFirst] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const ok = (await LocalAuth.hasHardwareAsync()) && (await LocalAuth.isEnrolledAsync());
        // A failed type lookup keeps the generic label; the row itself still shows.
        const types = ok ? await LocalAuth.supportedAuthenticationTypesAsync().catch(() => []) : [];
        const labelKey = biometricLabelKey(types);
        if (live) {
          setBioLabelKey(labelKey);
          setBiometric(ok);
        }
      } catch {
        // No usable biometrics reads as unavailable; the PIN path still works.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function useBiometric() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // On success the gatekeeper sees the stored method and leaves this screen.
      if (!(await enableBiometric())) setStep("pin");
    } catch {
      setError(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (busy) return;
    skipSetup();
  }

  async function onPin(v: string) {
    setValue(v);
    if (!isValidPin(v)) return;
    if (step === "pin") {
      setFirst(v);
      setValue("");
      setError(null);
      setStep("confirm");
      return;
    }
    if (v !== first) {
      setError(t("lock.mismatch"));
      setValue("");
      setStep("pin");
      return;
    }
    setBusy(true);
    try {
      await setPin(v);
    } catch {
      setError(t("common.genericError"));
      setValue("");
      setStep("pin");
      setBusy(false);
    }
  }

  if (step === "choose") {
    return (
      <Screen style={{ paddingHorizontal: 20, paddingBottom: 28 + insets.bottom }}>
        <View style={{ flex: 1, justifyContent: "center", gap: 30 }}>
          <PinBoxes length={0} idle />
          <View style={{ gap: 8 }}>
            <Txt weight={600} size={28} lineHeight={32} accessibilityRole="header">
              {t("lock.setupTitle")}
            </Txt>
            <Txt size={16} color={color.ink2}>
              {t("lock.setupBody")}
            </Txt>
          </View>
          {error ? (
            <Txt accessibilityRole="alert" accessibilityLiveRegion="polite" size={15} color={color.downText}>
              {error}
            </Txt>
          ) : null}
          <View style={{ borderWidth: 1, borderColor: color.ruleSoft, borderRadius: radius.lg, backgroundColor: color.surface, overflow: "hidden" }}>
            {biometric ? (
              <OptionRow icon="fingerprint" tone="accent" title={t(bioLabelKey)} hint={t("lock.fingerprintHint")} onPress={useBiometric} disabled={busy} />
            ) : null}
            <OptionRow testID="lock-set-pin" icon="key" tone="muted" title={t("lock.setPin")} hint={t("lock.pinHint")} onPress={() => setStep("pin")} disabled={busy} last />
          </View>
        </View>
        <Button kind="text" label={t("lock.skip")} onPress={skip} disabled={busy} />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingBottom: insets.bottom }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 22, paddingHorizontal: 20 }}>
        <Txt weight={600} size={24} accessibilityRole="header" style={{ textAlign: "center" }}>
          {step === "pin" ? t("lock.setPin") : t("lock.confirmPin")}
        </Txt>
        <PinBoxes length={value.length} error={!!error} label={t("lock.pinEntered", { count: value.length })} />
        {/* Reserved slot: the pad sits outside this block, so the message appearing never moves the keys. */}
        <Txt accessibilityRole={error ? "alert" : undefined} accessibilityLiveRegion="polite" numberOfLines={2} size={15} color={color.downText} style={{ minHeight: 40, textAlign: "center" }}>
          {error}
        </Txt>
      </View>
      <PinPad value={value} onChange={onPin} disabled={busy} />
      <View style={{ height: 16 }} />
    </Screen>
  );
}
