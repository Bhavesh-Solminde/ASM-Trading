import * as SecureStore from "expo-secure-store";
import { parseSenderList } from "./senders";
import type { RelayConfig } from "./types";

const KEY_SERVER = "relay.serverUrl";
const KEY_SECRET = "relay.secret";
const KEY_SENDERS = "relay.senders";

const EMPTY: RelayConfig = { serverUrl: "", secret: "", senders: [] };

/**
 * The relay secret lives in the OS keystore, never in a committed file and
 * never in plain AsyncStorage.
 */
export async function loadConfig(): Promise<RelayConfig> {
  try {
    const [serverUrl, secret, senders] = await Promise.all([
      SecureStore.getItemAsync(KEY_SERVER),
      SecureStore.getItemAsync(KEY_SECRET),
      SecureStore.getItemAsync(KEY_SENDERS),
    ]);

    return {
      serverUrl: serverUrl ?? "",
      secret: secret ?? "",
      senders: parseSenderList(senders ?? ""),
    };
  } catch {
    return EMPTY;
  }
}

export async function saveConfig(config: RelayConfig): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_SERVER, config.serverUrl.trim()),
    SecureStore.setItemAsync(KEY_SECRET, config.secret.trim()),
    SecureStore.setItemAsync(KEY_SENDERS, config.senders.join(",")),
  ]);
}

export function isConfigComplete(config: RelayConfig): boolean {
  return (
    config.serverUrl.startsWith("http") &&
    config.secret.length > 0 &&
    config.senders.length > 0
  );
}
