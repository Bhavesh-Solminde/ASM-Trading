import webpush from "web-push";
import type { PushMessage } from "./messages";
import type { SendOutcome } from "./fcm";

export class WebPushTransport {
  private readonly sendImpl: typeof webpush.sendNotification;

  constructor(
    private readonly cfg: { publicKey: string; privateKey: string; subject: string },
    deps: { sendNotification?: typeof webpush.sendNotification } = {},
  ) {
    this.sendImpl = deps.sendNotification ?? webpush.sendNotification.bind(webpush);
  }

  async send(sub: { endpoint: string; p256dh: string; auth: string }, m: PushMessage): Promise<SendOutcome> {
    try {
      await this.sendImpl(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: m.title, body: m.body, url: m.url }),
        { vapidDetails: { subject: this.cfg.subject, publicKey: this.cfg.publicKey, privateKey: this.cfg.privateKey }, TTL: 3600, timeout: 10_000 },
      );
      return "ok";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? "dead" : "retry";
    }
  }
}

export function webPushTransportFromEnv(env: Record<string, string | undefined> = process.env): WebPushTransport | null {
  const publicKey = env["VAPID_PUBLIC_KEY"];
  const privateKey = env["VAPID_PRIVATE_KEY"];
  const subject = env["VAPID_SUBJECT"];
  return publicKey && privateKey && subject ? new WebPushTransport({ publicKey, privateKey, subject }) : null;
}
