import type { RelayConfig } from "./types";

// There is no Settings screen (Plan 06's original design cut it — see
// docs/superpowers/plans/README.md). Values are baked in at build time.
//
// The shared secret (must match apps/web's SMS_RELAY_SECRET) comes from
// apps/relay/.env.local, which is gitignored: Expo inlines EXPO_PUBLIC_*
// variables into the JS bundle when the APK is built, so the real secret
// lives in the APK but never in git. That also means a built APK must never
// be published anywhere public — anyone holding it can extract the secret
// and post forged credit SMS. Hand it to the operator's phones directly.
//
// Each env var must be read as a literal `process.env.EXPO_PUBLIC_…` member
// access — that exact form is what Expo's bundler replaces.
//
// senders are case-insensitive substrings of the SMS sender ID (e.g.
// "JD-INDUSB-S" contains "INDUS"). Kept deliberately broad: a missed credit
// leaves a paid deposit stuck, whereas an extra forwarded message is only
// logged and ignored by the parser unless it is a credit for the exact
// reserved amount of a live deposit.
export const RELAY_CONFIG: RelayConfig = {
  serverUrl: process.env.EXPO_PUBLIC_RELAY_SERVER_URL ?? "https://asmtrader.com",
  secret: process.env.EXPO_PUBLIC_RELAY_SECRET ?? "",
  senders: (
    process.env.EXPO_PUBLIC_RELAY_SENDERS ??
    // PHONEPE catches both PhonePe Business ("AX-PHONEPE-S") and the
    // consumer app's own SMS alerts. Each merchant QR paid to a configured
    // VPA fires one of these per credit, and the SMS path is faster and
    // more reliable than the Notification listener (which the OS can
    // revoke on reboot or battery save).
    // Substring match (see RelayStore.isAllowedSender), so "IDFC" catches
    // both "AX-IDFCFB-S" and "VK-IDFC-S" style sender IDs — no need to
    // enumerate the prefixes.
    "SBI,CANBNK,CANARA,HDFC,INDUS,IDFC,PHONEPE"
  )
    .split(",")
    .map((sender: string) => sender.trim())
    .filter((sender: string) => sender.length > 0),
  deviceLabel: process.env.EXPO_PUBLIC_RELAY_DEVICE_LABEL ?? "Bhavesh's phone",
};
