import type { AuthenticationType } from "expo-local-authentication";

/** `AuthenticationType.FINGERPRINT`. A type-only import keeps this module free of the native package, so it unit-tests in node. */
const FINGERPRINT: AuthenticationType = 1;

/**
 * Label key for the lock-setup biometric row. Biometric unlock uses the default (weak) security level, so face unlock works
 * too; say "fingerprint" only when the phone has a fingerprint sensor, otherwise the generic "fingerprint or face".
 */
export function biometricLabelKey(types: readonly AuthenticationType[]): "lock.fingerprint" | "lock.useBiometric" {
  return types.includes(FINGERPRINT) ? "lock.fingerprint" : "lock.useBiometric";
}
