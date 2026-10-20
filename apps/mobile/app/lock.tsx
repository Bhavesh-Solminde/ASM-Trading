import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/auth/session-store";
import { loadLastNickname } from "@/cache/resume-cache";
import { useLock } from "@/lock/lock-store";
import { PinBoxes } from "@/lock/PinBoxes";
import { PinPad } from "@/lock/PinPad";
import { isValidPin } from "@/lock/pin";
import { MAX_PIN_ATTEMPTS } from "@/lock/rules";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { BrandMark } from "@/ui/Brand";

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
  const [bioBusy, setBioBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompting = useRef(false);
  // Read once per mount: the greeting never changes while the lock is up. Nickname only, never the email or balance.
  const [name] = useState(() => loadLastNickname());

  // One system prompt at a time: repeated taps must not stack prompts.
  const promptBiometric = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setBioBusy(true);
    try {
      await unlockWithBiometric();
    } finally {
      prompting.current = false;
      setBioBusy(false);
    }
  }, [unlockWithBiometric]);

  useEffect(() => {
    if (method === "biometric") void promptBiometric();
  }, [method, promptBiometric]);

  async function onPin(v: string) {
    setValue(v);
    if (!isValidPin(v) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPin(v);
      if (result === "logout") router.replace("/login");
    } catch {
      setError(t("common.genericError"));
    } finally {
      setValue("");
      setBusy(false);
    }
  }

  async function forgot() {
    try {
      await signOut();
      await reset();
    } catch {
      // Best effort: the user is sent to login either way.
    }
    router.replace("/login");
  }

  // One reserved line, so the pad does not jump when a message appears.
  const message = error ?? (attempts > 0 ? t("lock.wrongPin", { count: MAX_PIN_ATTEMPTS - attempts }) : "");

  return (
    <Screen style={{ paddingBottom: insets.bottom }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 22, paddingHorizontal: 20 }}>
        <View style={{ alignItems: "center", gap: 10 }}>
          <BrandMark width={72} />
          <Txt weight={600} size={24} accessibilityRole="header" numberOfLines={1} style={{ textAlign: "center" }}>
            {name ? t("lock.welcomeName", { name }) : t("lock.welcome")}
          </Txt>
          {method === "pin" ? (
            <Txt size={15} color={color.ink2}>
              {t("lock.enterPin")}
            </Txt>
          ) : null}
        </View>
        {method === "pin" ? (
          <>
            <PinBoxes length={value.length} error={message !== ""} errorKey={attempts} label={t("lock.pinEntered", { count: value.length })} />
            {/* The pad sits outside this block, so a taller message only re-centres the boxes, it never moves the keys. */}
            <Txt
              testID="lock-message"
              accessibilityRole={message ? "alert" : undefined}
              accessibilityLiveRegion="polite"
              numberOfLines={2}
              size={15}
              color={color.downText}
              style={{ minHeight: 40, textAlign: "center" }}
            >
              {message}
            </Txt>
          </>
        ) : method === "biometric" ? (
          <View style={{ alignSelf: "stretch" }}>
            <Button label={t("lock.useBiometric")} icon="fingerprint" onPress={promptBiometric} busy={bioBusy} />
          </View>
        ) : (
          // The lock settings could not be read: the only way on is to sign in again.
          <Txt size={15} color={color.downText} style={{ textAlign: "center" }}>
            {t("lock.unavailable")}
          </Txt>
        )}
      </View>
      {method === "pin" ? <PinPad value={value} onChange={onPin} disabled={busy} /> : null}
      <View style={{ marginBottom: 16 }}>
        <Button kind="text" label={t("lock.forgotPin")} onPress={forgot} />
      </View>
    </Screen>
  );
}
