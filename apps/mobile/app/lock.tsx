import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
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

// A fixed height (not minHeight): a two-line message must not push the pad down mid-entry.
const styles = StyleSheet.create({ messageSlot: { height: 40 } });

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
    <Screen style={{ padding: space(5), paddingBottom: space(5) + insets.bottom, gap: space(5), justifyContent: "center" }}>
      <Txt variant="title">{t("lock.title")}</Txt>
      {method === "pin" ? (
        <>
          <Txt
            testID="lock-message"
            accessibilityRole={message ? "alert" : undefined}
            numberOfLines={2}
            style={[formStyles.error, styles.messageSlot]}
          >
            {message}
          </Txt>
          <PinPad value={value} onChange={onPin} disabled={busy} />
        </>
      ) : method === "biometric" ? (
        <Button label={t("lock.useBiometric")} onPress={promptBiometric} busy={bioBusy} />
      ) : (
        // The lock settings could not be read: the only way on is to sign in again.
        <Txt style={formStyles.error}>{t("lock.unavailable")}</Txt>
      )}
      <Button label={t("lock.forgotPin")} kind="secondary" onPress={forgot} />
    </Screen>
  );
}
