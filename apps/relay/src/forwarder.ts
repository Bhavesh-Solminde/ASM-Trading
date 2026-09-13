import * as Device from "expo-device";
import { logActivity } from "./activityLog";
import { dueMessages, markFailed, markSent } from "./queue";
import type { RelayConfig } from "./types";

const deviceModel = Device.modelName ?? Device.deviceName ?? "unknown-device";

const DRAIN_INTERVAL_MS = 4_000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 12;

interface PostResult {
  ok: boolean;
  detail: string;
}

async function postOne(
  config: RelayConfig,
  message: { sender: string; body: string; receivedAt: number },
): Promise<PostResult> {
  try {
    const response = await fetch(`${config.serverUrl}/api/bank-feed/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify({
        sender: message.sender,
        body: message.body,
        receivedAt: new Date(message.receivedAt).toISOString(),
        deviceLabel: config.deviceLabel,
        deviceModel,
      }),
    });

    if (response.status === 202 || response.status === 400) {
      return { ok: true, detail: `HTTP ${response.status}` };
    }

    const bodyText = await response.text().catch(() => "");
    return {
      ok: false,
      detail: `HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 120)}` : ""}`,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Drains the outbox on a timer. At-least-once delivery; the server's unique
 * constraint on UTR makes the duplicate harmless.
 */
export function startForwarder(getConfig: () => RelayConfig): { stop(): void } {
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const drain = async (): Promise<void> => {
    const config = getConfig();

    if (config.serverUrl.startsWith("http") && config.secret.length > 0) {
      const batch = await dueMessages(BATCH_SIZE).catch(() => []);

      for (const message of batch) {
        if (message.attempts >= MAX_ATTEMPTS) {
          logActivity(message.sender, false, "Gave up after 12 attempts");
          await markFailed(message.id, message.attempts).catch(() => {});
          continue;
        }

        const result = await postOne(config, message);
        logActivity(message.sender, result.ok, result.detail);

        if (result.ok) {
          await markSent(message.id).catch(() => {});
        } else {
          await markFailed(message.id, message.attempts).catch(() => {});
        }
      }
    }

    if (running) timer = setTimeout(() => void drain(), DRAIN_INTERVAL_MS);
  };

  void drain();

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
