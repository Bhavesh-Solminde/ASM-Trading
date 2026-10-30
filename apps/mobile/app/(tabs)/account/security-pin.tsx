import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  finishVerify,
  confirmWithBiometric,
  initialEntry,
  parsePinParams,
  pinParams,
  pinScreenStep,
  submitPin,
  verifyOutcome,
  wrongPinCount,
  type AfterVerify,
  type PinEntry,
} from "@/account/security-flow";
import { clearSecurityGrant, grantSecurityChange, securityGrantFresh } from "@/account/security-grant";
import { useLock } from "@/lock/lock-store";
import { PinBoxes } from "@/lock/PinBoxes";
import { PinPad } from "@/lock/PinPad";
import { isValidPin } from "@/lock/pin";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { toast } from "@/ui/Toast";

/** Back to Security, or (opened cold by a link, nothing to go back to) onto it. Never to /lock or /lock-setup. */
function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/account/security");
}

/**
 * The PIN screen of Security: `?mode=set` (enter, confirm, save) and `?mode=verify&next=disable|change` (the current
 * PIN, or the fingerprint when that is the lock's method). What it does is decided once, on open, by `pinScreenStep`:
 * a set on a live lock with no fresh verify behind it turns into the verify step. Wrong PINs are counted by the lock
 * store (`verifyPin`), which also ends the session on the fifth; this screen only shows the count it keeps.
 */
export default function SecurityPin() {
  const raw = useLocalSearchParams<{ mode?: string | string[]; next?: string | string[] }>();
  // Frozen at mount: saving a PIN turns the lock on, which must not flip this screen into a verify step mid-save.
  const [plan] = useState(() => pinScreenStep(parsePinParams(raw), { enabled: useLock.getState().enabled, method: useLock.getState().method }, securityGrantFresh()));
  const left = useRef(false);
  useEffect(() => {
    if (plan.step === "leave" && !left.current) {
      left.current = true;
      close();
    }
  }, [plan.step]);

  if (plan.step === "set") return <SetStep />;
  if (plan.step === "verify" && plan.next) return <VerifyStep next={plan.next} viaPin={plan.via === "pin"} />;
  return <Screen>{null}</Screen>;
}

function SetStep() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const setPin = useLock((s) => s.setPin);
  const [entry, setEntry] = useState<PinEntry>(initialEntry);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A new failure is a new key, so a repeated mismatch turns the boxes red again.
  const [misses, setMisses] = useState(0);
  const inFlight = useRef(false);

  // Whatever way this screen closes, the verify behind it is spent.
  useEffect(() => () => clearSecurityGrant(), []);

  async function onChange(v: string) {
    setValue(v);
    if (!isValidPin(v) || inFlight.current) return;
    const result = submitPin(entry, v);
    setEntry(result.entry);
    setError(result.entry.error ? t(result.entry.error) : null);
    if (result.entry.error) setMisses((n) => n + 1);
    setValue("");
    if (result.save === null) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await setPin(result.save);
      clearSecurityGrant();
      toast(t("security.pinSaved"), "up");
      close();
    } catch {
      setError(t("common.genericError"));
      setEntry(initialEntry);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen style={{ paddingBottom: insets.bottom }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
        <BackHeader title={t("security.title")} onBack={close} />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 22, paddingHorizontal: 20 }}>
        <Txt weight={600} size={24} accessibilityRole="header" style={{ textAlign: "center" }}>
          {entry.step === "enter" ? t("lock.setPin") : t("lock.confirmPin")}
        </Txt>
        {entry.step === "enter" ? (
          <Txt size={15} color={color.ink2} style={{ textAlign: "center" }}>
            {t("security.setBody")}
          </Txt>
        ) : null}
        <PinBoxes length={value.length} error={!!error} errorKey={misses} label={t("lock.pinEntered", { count: value.length })} />
        {/* Reserved slot: the pad sits outside this block, so the message appearing never moves the keys. */}
        <Txt testID="security-pin-message" accessibilityRole={error ? "alert" : undefined} accessibilityLiveRegion="polite" numberOfLines={2} size={15} color={color.downText} style={{ minHeight: 40, textAlign: "center" }}>
          {error}
        </Txt>
      </View>
      <PinPad value={value} onChange={(v) => void onChange(v)} disabled={busy} />
      <View style={{ height: 16 }} />
    </Screen>
  );
}

function VerifyStep({ next, viaPin }: { next: AfterVerify; viaPin: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const method = useLock((s) => s.method);
  const attempts = useLock((s) => s.attempts);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a miss on this screen turns the boxes red: tries already used elsewhere show as text, not as a fresh error.
  const [missed, setMissed] = useState(false);
  // Whether an app PIN is stored; only asked on a fingerprint lock (a PIN lock always has one).
  const [pinStored, setPinStored] = useState<boolean | null>(null);
  const [fingerprintMissed, setFingerprintMissed] = useState(false);
  // "Use your app PIN instead", tapped after the fingerprint check failed.
  const [chosePin, setChosePin] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (method !== "biometric") return;
    let live = true;
    void useLock
      .getState()
      .hasPin()
      .then((stored) => {
        if (live) setPinStored(stored);
      })
      .catch(() => {
        if (live) setPinStored(false);
      });
    return () => {
      live = false;
    };
  }, [method]);

  // The PIN pad on a PIN lock; on a fingerprint lock only when the PIN was asked for and one is stored.
  const usePad = method === "pin" || ((viaPin || chosePin) && pinStored === true);

  // The check passed: switch the lock off, hand over to the set step with a fresh verify behind it, or turn the fingerprint on.
  async function proceed() {
    const outcome = await finishVerify(next, { disable: () => useLock.getState().disable(), enableBiometric: () => useLock.getState().enableBiometric() });
    if (outcome === "disabled") {
      toast(t("security.lockOff"));
      close();
    } else if (outcome === "set-pin") {
      grantSecurityChange();
      router.replace({ pathname: "/account/security-pin", params: pinParams("set") });
    } else if (outcome === "fingerprint-on") {
      toast(t("security.fingerprintOn"), "up");
      close();
    } else if (outcome === "fingerprint-declined") {
      toast(t("security.fingerprintNotOn"), "down");
      close();
    } else {
      setError(t(next === "fingerprint" ? "security.turnOnFailed" : "security.turnOffFailed"));
    }
  }

  async function onPin(v: string) {
    setValue(v);
    if (!isValidPin(v) || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const outcome = verifyOutcome(await useLock.getState().verifyPin(v));
      // "signed-out": the store already ended the session (fifth wrong PIN); the gate takes the app to login.
      if (outcome === "signed-out") router.replace("/login");
      else if (outcome === "retry") setMissed(true);
      else await proceed();
    } catch {
      setError(t("common.genericError"));
    } finally {
      setValue("");
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function onBiometric() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // Biometric only: the phone's screen-lock PIN is not proof of being the owner of the app lock.
      const checked = await confirmWithBiometric({ confirm: () => useLock.getState().confirmBiometric(t("security.verifyPrompt")) });
      if (checked === "verified") await proceed();
      else {
        setFingerprintMissed(true);
        setError(t(checked === "failed" ? "common.genericError" : "security.verifyFailed"));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const tries = wrongPinCount(attempts);
  const message = error ?? (usePad && tries !== null ? t("lock.wrongPin", { count: tries }) : "");

  return (
    <Screen style={{ paddingBottom: insets.bottom }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
        <BackHeader title={t("security.title")} onBack={close} />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 22, paddingHorizontal: 20 }}>
        <Txt weight={600} size={24} accessibilityRole="header" style={{ textAlign: "center" }}>
          {usePad ? t("lock.enterPin") : t("security.verifyPrompt")}
        </Txt>
        <Txt size={15} color={color.ink2} style={{ textAlign: "center" }}>
          {usePad ? t("security.verifyBody") : t("security.verifyBiometricBody")}
        </Txt>
        {usePad ? <PinBoxes length={value.length} error={missed || error !== null} errorKey={attempts} label={t("lock.pinEntered", { count: value.length })} /> : null}
        <Txt testID="security-pin-message" accessibilityRole={message ? "alert" : undefined} accessibilityLiveRegion="polite" numberOfLines={3} size={15} color={color.downText} style={{ minHeight: 40, textAlign: "center" }}>
          {message}
        </Txt>
        {!usePad && method === "biometric" ? (
          <View style={{ alignSelf: "stretch", gap: 12 }}>
            <Button testID="security-confirm-fingerprint" label={t("security.confirmBiometric")} icon="fingerprint" busy={busy} onPress={() => void onBiometric()} />
            {fingerprintMissed && pinStored === true ? (
              <Button testID="security-use-pin-fallback" kind="secondary" label={t("security.usePinFallback")} onPress={() => setChosePin(true)} />
            ) : null}
          </View>
        ) : null}
      </View>
      {usePad ? <PinPad value={value} onChange={(v) => void onPin(v)} disabled={busy} /> : null}
      <View style={{ height: 16 }} />
    </Screen>
  );
}
