import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lockValueKey } from "@/account/hub-model";
import { afterEnableBiometric, decideToggle, disableWithBiometric, lockIsOn, lockRows, pinParams, type LockSnapshot } from "@/account/security-flow";
import { grantSecurityChange } from "@/account/security-grant";
import { useLock } from "@/lock/lock-store";
import { useBiometricInfo } from "@/lock/useBiometricInfo";
import { color } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { KeyValueBox } from "@/ui/KeyValueBox";
import { SettingsRow } from "@/ui/SettingsRow";
import { toast } from "@/ui/Toast";

/**
 * Security (R2 "Security"): the app lock switch and, while it is on, how it unlocks. Every decision comes from
 * `security-flow`; the rules it keeps are the point of this screen:
 *  - turning the lock OFF re-verifies first (the fingerprint here, the current PIN on the PIN screen);
 *  - changing the PIN or switching from fingerprint to PIN re-verifies first;
 *  - nothing here sends the user to /lock or /lock-setup (those belong to the gate): setting a PIN is
 *    /account/security-pin, and turning the fingerprint on is the lock store's own prompt.
 * There are no two-factor toggles: the server never enforces them.
 */
export default function Security() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const enabled = useLock((s) => s.enabled);
  const method = useLock((s) => s.method);
  const lock: LockSnapshot = { enabled, method };
  const on = lockIsOn(lock);
  const biometric = useBiometricInfo();
  const rows = lockRows(lock, biometric.available);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A plain ref, not state: two taps in one frame must not both pass.
  const inFlight = useRef(false);

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const toPinScreen = (mode: "set" | "verify", next?: "disable" | "change") => router.push({ pathname: "/account/security-pin", params: pinParams(mode, next) });

  const verifyByFingerprint = () => useLock.getState().unlockWithBiometric(t("security.verifyPrompt"));

  const toggle = () =>
    run(async () => {
      const decision = decideToggle(lock, biometric.available);
      switch (decision.kind) {
        case "enable-biometric": {
          let ok = false;
          try {
            ok = await useLock.getState().enableBiometric();
          } catch {
            setMessage(t("security.turnOnFailed"));
            return;
          }
          if (afterEnableBiometric(ok) === "set-pin") toPinScreen("set");
          else toast(t("security.fingerprintOn"), "up");
          return;
        }
        case "set-pin":
          toPinScreen("set");
          return;
        case "verify-pin-then-disable":
          toPinScreen("verify", "disable");
          return;
        case "verify-biometric-then-disable": {
          const result = await disableWithBiometric({ verify: verifyByFingerprint, disable: () => useLock.getState().disable() });
          if (result === "disabled") toast(t("security.lockOff"));
          else setMessage(t(result === "not-verified" ? "security.verifyFailed" : "security.turnOffFailed"));
          return;
        }
      }
    });

  const switchToFingerprint = () =>
    run(async () => {
      let ok = false;
      try {
        ok = await useLock.getState().enableBiometric();
      } catch {
        // Falls through to the message below.
      }
      if (ok) toast(t("security.fingerprintOn"), "up");
      else setMessage(t("security.fingerprintNotOn"));
    });

  const switchToPin = () =>
    run(async () => {
      let verified = false;
      try {
        verified = await verifyByFingerprint();
      } catch {
        // An unreadable sensor never verifies.
      }
      if (!verified) {
        setMessage(t("security.verifyFailed"));
        return;
      }
      grantSecurityChange();
      toPinScreen("set");
    });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 20 + insets.bottom }}>
        <BackHeader title={t("security.title")} />
        <Pressable
          testID="security-lock-switch"
          accessibilityRole="switch"
          accessibilityLabel={t("security.appLock")}
          accessibilityHint={t("security.appLockHint")}
          accessibilityState={{ checked: on, busy, disabled: busy }}
          disabled={busy}
          onPress={() => void toggle()}
          style={({ pressed }) => ({ minHeight: 72, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? 0.85 : 1 })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={17} weight={600}>
              {t("security.appLock")}
            </Txt>
            <Txt size={14} color={color.ink2}>
              {t("security.appLockHint")}
            </Txt>
          </View>
          {/* The row is the control; the switch only shows its state. */}
          <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Switch value={on} trackColor={{ false: color.rule, true: color.accent }} thumbColor={color.ink} />
          </View>
        </Pressable>
        {message ? (
          <Txt testID="security-message" accessibilityRole="alert" accessibilityLiveRegion="polite" size={14} color={color.downText}>
            {message}
          </Txt>
        ) : null}
        {on ? (
          <>
            <KeyValueBox rows={[{ key: "method", testID: "security-method", label: t("security.methodTitle"), value: t(lockValueKey(lock)) }]} />
            <View>
              {rows.changePin ? <SettingsRow testID="security-change-pin" icon="key" title={t("security.changePin")} onPress={() => toPinScreen("verify", "change")} /> : null}
              {rows.useFingerprint ? <SettingsRow testID="security-use-fingerprint" icon="fingerprint" title={t(biometric.labelKey)} onPress={() => void switchToFingerprint()} /> : null}
              {rows.usePin ? <SettingsRow testID="security-use-pin" icon="key" title={t("security.usePin")} onPress={() => void switchToPin()} /> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
