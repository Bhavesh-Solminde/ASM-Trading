import { dueMessages, markFailed, markSent } from "./queue";
import type { RelayConfig } from "./types";

const DRAIN_INTERVAL_MS = 4_000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 12;

async function postOne(
  config: RelayConfig,
  message: { sender: string; body: string; receivedAt: number },
): Promise<boolean> {
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
      }),
    });

    return response.status === 202 || response.status === 400;
  } catch {
    return false;
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
          await markFailed(message.id, message.attempts).catch(() => {});
          continue;
        }

        const ok = await postOne(config, message);
        if (ok) {
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
