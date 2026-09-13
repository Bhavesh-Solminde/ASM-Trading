import type { RelayConfig } from "./types";

/**
 * Configured by us at build time, not by the end user — there is no Settings
 * screen. Edit these values and rebuild to point the app at a different
 * server or sender list.
 */
export const RELAY_CONFIG: RelayConfig = {
  serverUrl: "https://asm-trading-sms-test.vercel.app",
  secret: "test123",
  senders: ["SBI"],
  deviceLabel: "Bhavesh's phone",
};
