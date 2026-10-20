import { describe, expect, it } from "vitest";
import { biometricLabelKey } from "./biometric-label";

// expo-local-authentication AuthenticationType: FINGERPRINT = 1, FACIAL_RECOGNITION = 2, IRIS = 3.
describe("biometricLabelKey", () => {
  it("says fingerprint only when the phone supports a fingerprint sensor", () => {
    expect(biometricLabelKey([1])).toBe("lock.fingerprint");
    expect(biometricLabelKey([2, 1])).toBe("lock.fingerprint");
  });

  it("falls back to the generic fingerprint-or-face string without one", () => {
    expect(biometricLabelKey([2])).toBe("lock.useBiometric");
    expect(biometricLabelKey([3])).toBe("lock.useBiometric");
    expect(biometricLabelKey([])).toBe("lock.useBiometric");
  });
});
