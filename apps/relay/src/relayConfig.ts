import type { RelayConfig } from "./types";

/**
 * Configured by us at build time, not by the end user — there is no Settings
 * screen. Edit these values and rebuild to point the app at a different
 * server or sender list.
 */
export const RELAY_CONFIG: RelayConfig = {
  serverUrl: "http://192.168.0.101:3000",
  secret: "test123",
  senders: ["SBI"],
  deviceLabel: "Bhavesh's phone",
};
