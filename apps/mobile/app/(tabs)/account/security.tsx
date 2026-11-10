import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lockValueKey } from "@/account/hub-model";
import {
  afterEnableBiometric,
  biometricFailureFallback,
  confirmWithBiometric,
  decideToggle,
  decideUseFingerprint,
  decideUsePin,
  disableWithBiometric,
  lockIsOn,
  lockRows,
  pinParams,
  type AfterVerify,
  type LockSnapshot,
} from "@/account/security-flow";
import { grantSecurityChange } from "@/account/security-grant";
import { useLock } from "@/lock/lock-store";
import { useBiometricInfo } from "@/lock/useBiometricInfo";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
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
  // After a biometric check failed and an app PIN is stored: the same step through the PIN.
  const [fallback, setFallback] = useState<AfterVerify | null>(null);
  // A plain ref, not state: two taps in one frame must not both pass.
  const inFlight = useRef(false);

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setFallback(null);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const toPinScreen = (mode: "set" | "verify", next?: AfterVerify, via?: "pin") => router.push({ pathname: "/account/security-pin", params: pinParams(mode, next, via) });

  // Biometric only: the phone's own screen-lock PIN is not proof of being the owner of the app lock.
  const confirmByBiometric = () => useLock.getState().confirmBiometric(t("security.verifyPrompt"));

  /** The biometric check did not pass: say so, and offer the app PIN for the same step when one is stored. */
  const biometricMissed = async (next: AfterVerify, failed: boolean) => {
    setMessage(t(failed ? "security.turnOffFailed" : "security.verifyFailed"));
    let stored = false;
    try {
      stored = await useLock.getState().hasPin();
    } catch {
      // Unreadable: no fallback is offered.
    }
    setFallback(biometricFailureFallback(next, stored));
  };

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
          const result = await disableWithBiometric({ verify: confirmByBiometric, disable: () => useLock.getState().disable() });
          if (result === "disabled") toast(t("security.lockOff"));
          else await biometricMissed("disable", result === "failed");
          return;
        }
      }
    });

  // PIN lock -> fingerprint lock: the app PIN first (decideUseFingerprint), then the PIN screen turns the fingerprint on.
  const switchToFingerprint = () => {
    if (decideUseFingerprint(lock, biometric.available).kind === "verify-pin-then-enable-biometric") toPinScreen("verify", "fingerprint");
  };

  // Fingerprint lock -> PIN lock: the biometric first (decideUsePin), then the set step with a fresh verify behind it.
  const switchToPin = () =>
    run(async () => {
      if (decideUsePin(lock).kind !== "verify-biometric-then-set-pin") return;
      const checked = await confirmWithBiometric({ confirm: confirmByBiometric });
      if (checked !== "verified") {
        await biometricMissed("change", checked === "failed");
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
          accessibilityState={{ checked: on, busy, disabled: busy || !biometric.probed }}
          disabled={busy || !biometric.probed}
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
        {fallback ? <Button testID="security-use-pin-fallback" kind="secondary" label={t("security.usePinFallback")} onPress={() => toPinScreen("verify", fallback, "pin")} /> : null}
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
