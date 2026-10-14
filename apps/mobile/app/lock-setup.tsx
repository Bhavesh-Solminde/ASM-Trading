import * as LocalAuth from "expo-local-authentication";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLock } from "@/lock/lock-store";
import { PinPad } from "@/lock/PinPad";
import { isValidPin } from "@/lock/pin";
import { space } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { formStyles } from "@/ui/form";

export default function LockSetup() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { enableBiometric, setPin, skipSetup } = useLock();
  const [step, setStep] = useState<"choose" | "pin" | "confirm">("choose");
  const [biometric, setBiometric] = useState(false);
  const [first, setFirst] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const ok = (await LocalAuth.hasHardwareAsync()) && (await LocalAuth.isEnrolledAsync());
        if (live) setBiometric(ok);
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

  return (
    <Screen style={{ padding: space(5), paddingBottom: space(5) + insets.bottom, gap: space(4), justifyContent: "center" }}>
      <Txt variant="title">{t("lock.setupTitle")}</Txt>
      {step === "choose" ? (
        <>
          {error ? <Txt accessibilityRole="alert" style={formStyles.error}>{error}</Txt> : null}
          {biometric ? <Button label={t("lock.useBiometric")} onPress={useBiometric} busy={busy} /> : null}
          <Button label={t("lock.setPin")} kind={biometric ? "secondary" : "primary"} onPress={() => setStep("pin")} disabled={busy} />
          <Button label={t("lock.skip")} kind="secondary" onPress={skip} disabled={busy} />
        </>
      ) : (
        <>
          <Txt>{step === "pin" ? t("lock.setPin") : t("lock.confirmPin")}</Txt>
          {/* Reserved line: the pad does not jump when the message appears. */}
          <Txt accessibilityRole={error ? "alert" : undefined} style={[formStyles.error, formStyles.messageSlot]}>
            {error}
          </Txt>
          <PinPad value={value} onChange={onPin} disabled={busy} />
        </>
      )}
    </Screen>
  );
}
