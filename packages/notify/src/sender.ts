import type { PushDevice } from "@asm/db";
import type { SendOutcome } from "./fcm";
import type { FcmTransport } from "./fcm";
import type { PushMessage } from "./messages";
import type { WebPushTransport } from "./webpush";

type Locale = "en" | "hi";

export class PushSender {
  constructor(
    private readonly deps: {
      fcm: Pick<FcmTransport, "send"> | null;
      web: Pick<WebPushTransport, "send"> | null;
      devices: (userId: string) => Promise<PushDevice[]>;
      dropToken: (token: string) => Promise<void>;
    },
  ) {}

  async sendToUser(
    userId: string,
    render: (locale: Locale, platform: "ANDROID" | "WEBPUSH") => PushMessage,
  ): Promise<{ delivered: number; retry: boolean; deferred?: boolean }> {
    const devices = await this.deps.devices(userId);
    // Hold the whole event if one of this user's platforms is not configured, avoiding both loss and repeated
    // delivery to the other platform while the operator finishes setup.
    if (devices.some((d) => d.platform === "ANDROID" ? !this.deps.fcm : !this.deps.web)) return { delivered: 0, retry: false, deferred: true };
    let delivered = 0;
    let retry = false;
    await Promise.all(
      devices.map(async (d) => {
        const locale: Locale = d.platform === "WEBPUSH" ? "en" : d.locale === "hi" ? "hi" : "en";
        const message = render(locale, d.platform);
        let outcome: SendOutcome | "skip";
        if (d.platform === "ANDROID") outcome = this.deps.fcm ? await this.deps.fcm.send(d.token, message) : "skip";
        else if (this.deps.web && d.p256dh && d.auth) outcome = await this.deps.web.send({ endpoint: d.token, p256dh: d.p256dh, auth: d.auth }, message);
        else outcome = "skip";
        if (outcome === "ok") delivered += 1;
        else if (outcome === "dead") await this.deps.dropToken(d.token);
        else if (outcome === "retry") retry = true;
      }),
    );
    return { delivered, retry };
  }
}
