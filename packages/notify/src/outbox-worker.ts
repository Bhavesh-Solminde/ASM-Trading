import { claimOutbox, deferOutbox, markOutboxSent, notifyPrefs, pruneOutbox, type OutboxKind } from "@asm/db";
import { logger } from "@asm/logger";
import { channelFor, outboxMessage } from "./messages";
import type { PushSender } from "./sender";

const BATCH = 50;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const RETENTION_MS = 30 * 24 * 3600 * 1000;

export function startOutboxWorker(deps: { sender: Pick<PushSender, "sendToUser">; intervalMs?: number; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  let running: Promise<void> | null = null;
  let lastPrune = 0;

  async function performTick(): Promise<void> {
    const rows = await claimOutbox(BATCH, LEASE_MS);
    const done: typeof rows = [];
    await Promise.all(rows.map(async (row) => {
      const kind = row.kind as OutboxKind;
      try {
        const prefs = await notifyPrefs(row.userId);
        const channel = channelFor(kind);
        const muted = channel === "payments" ? !prefs.notifyPayments : !prefs.notifyAccount;
        if (muted || prefs.isBot) {
          done.push(row);
          return;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const out = await deps.sender.sendToUser(row.userId, (locale) => outboxMessage(kind, payload, locale));
        if (out.deferred) { await deferOutbox(row); return; }
        if (!out.retry || row.attempts >= MAX_ATTEMPTS) {
          if (out.retry) logger.warn({ evt: "push.outbox_gave_up", id: row.id, kind }, "push gave up after retries");
          done.push(row);
        }
      } catch (err) {
        logger.error({ evt: "push.outbox_failed", id: row.id, errorType: err instanceof Error ? err.name : "unknown" }, "outbox send failed");
        if (row.attempts >= MAX_ATTEMPTS) done.push(row);
      }
    }));
    await markOutboxSent(done);

    const t = now().getTime();
    if (t - lastPrune > 24 * 3600 * 1000) {
      lastPrune = t;
      await pruneOutbox(new Date(t - RETENTION_MS));
    }
  }

  let stopped = false;
  function tick(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = performTick().finally(() => { running = null; });
    return running;
  }
  const timer = setInterval(() => {
    void tick().catch((err) => logger.error({ evt: "push.outbox_tick_failed", errorType: err instanceof Error ? err.name : "unknown" }, "outbox tick failed"));
  }, deps.intervalMs ?? 2_000);

  return {
    tick,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
