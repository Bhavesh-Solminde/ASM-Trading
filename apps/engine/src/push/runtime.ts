import { listPushDevices, deletePushDeviceByToken, liveAccountCurrencies, liveTradeResults, notifyPrefs } from "@asm/db";
import { PushSender, fcmTransportFromEnv, startOutboxWorker, tradeResultsMessage, webPushTransportFromEnv } from "@asm/notify";
import { logger } from "@asm/logger";
import { TradeResultBatcher } from "./trade-results";

/** Both trading engines drain the same account-event outbox and batch offline trade results. */
export function startPushRuntime(isOnline: (userId: string) => boolean) {
  const fcm = fcmTransportFromEnv();
  const web = webPushTransportFromEnv();
  if (!fcm) logger.warn({ evt: "push.fcm_disabled" }, "Android push disabled: FCM configuration missing");
  if (!web) logger.warn({ evt: "push.web_disabled" }, "Web Push disabled: VAPID configuration missing");
  const sender = new PushSender({ fcm, web, devices: listPushDevices, dropToken: deletePushDeviceByToken });
  const batcher = new TradeResultBatcher({
    isOnline, liveAccounts: liveAccountCurrencies, settledResults: liveTradeResults, prefs: notifyPrefs,
    send: async (userId, results) => { await sender.sendToUser(userId, locale => tradeResultsMessage(results, locale)); },
  });
  const outbox = startOutboxWorker({ sender });
  return { batcher, outbox };
}
