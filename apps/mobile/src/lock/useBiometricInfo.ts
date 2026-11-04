import * as LocalAuth from "expo-local-authentication";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { biometricLabelKey } from "./biometric-label";

type LabelKey = ReturnType<typeof biometricLabelKey>;

/**
 * Whether this phone can unlock with a fingerprint or face (hardware present and one enrolled), and the label to show
 * for it. Probed every time the screen gains focus: someone may enrol a finger in system settings and come back.
 * `probed` is false until the first answer is in (a switch tapped before then must wait). Never throws; a failed probe reads as "not available" and the PIN path still works.
 */
export function useBiometricInfo(): { available: boolean; labelKey: LabelKey; probed: boolean } {
  const [info, setInfo] = useState<{ available: boolean; labelKey: LabelKey; probed: boolean }>({ available: false, labelKey: "lock.useBiometric", probed: false });
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        try {
          const ok = (await LocalAuth.hasHardwareAsync()) && (await LocalAuth.isEnrolledAsync());
          // A failed type lookup keeps the generic label; the row itself still shows.
          const types = ok ? await LocalAuth.supportedAuthenticationTypesAsync().catch(() => []) : [];
          if (live) setInfo({ available: ok, labelKey: biometricLabelKey(types), probed: true });
        } catch {
          if (live) setInfo({ available: false, labelKey: "lock.useBiometric", probed: true });
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );
  return info;
}
