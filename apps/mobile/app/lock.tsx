import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/auth/session-store";
import { useLock } from "@/lock/lock-store";
import { PinPad } from "@/lock/PinPad";
import { isValidPin } from "@/lock/pin";
import { MAX_PIN_ATTEMPTS } from "@/lock/rules";
import { space } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { formStyles } from "@/ui/form";

/** Shown while `useLock().locked` is true. Unlocking only clears that flag; the root gate (Task 7) routes away. */
export default function Lock() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const method = useLock((s) => s.method);
  const attempts = useLock((s) => s.attempts);
  const { verifyPin, unlockWithBiometric, reset } = useLock();
  const signOut = useSession((s) => s.signOut);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (method === "biometric") void unlockWithBiometric();
  }, [method, unlockWithBiometric]);

  async function onPin(v: string) {
    setValue(v);
    if (!isValidPin(v) || busy) return;
    setBusy(true);
    try {
      const result = await verifyPin(v);
      if (result === "logout") router.replace("/login");
    } finally {
      setValue("");
      setBusy(false);
    }
  }

  async function forgot() {
    await signOut();
    await reset();
    router.replace("/login");
  }

  return (
    <Screen style={{ padding: space(5), paddingBottom: space(5) + insets.bottom, gap: space(5), justifyContent: "center" }}>
      <Txt variant="title">{t("lock.title")}</Txt>
      {method === "pin" ? (
        <>
          {attempts > 0 ? (
            <Txt accessibilityRole="alert" style={formStyles.error}>
              {t("lock.wrongPin", { left: MAX_PIN_ATTEMPTS - attempts })}
            </Txt>
          ) : null}
          <PinPad value={value} onChange={onPin} disabled={busy} />
        </>
      ) : (
        <Button label={t("lock.useBiometric")} onPress={() => void unlockWithBiometric()} />
      )}
      <Button label={t("lock.forgotPin")} kind="secondary" onPress={forgot} />
    </Screen>
  );
}
