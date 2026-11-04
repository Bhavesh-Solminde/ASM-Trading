import { JWT } from "google-auth-library";
import type { PushMessage } from "./messages";

export type SendOutcome = "ok" | "dead" | "retry";

export class FcmTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly accessToken: () => Promise<string>;

  constructor(
    private readonly cfg: { projectId: string; clientEmail: string; privateKey: string },
    deps: { fetch?: typeof fetch; getAccessToken?: () => Promise<string> } = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    if (deps.getAccessToken) this.accessToken = deps.getAccessToken;
    else {
      const jwt = new JWT({ email: cfg.clientEmail, key: cfg.privateKey, scopes: ["https://www.googleapis.com/auth/firebase.messaging"], transporterOptions: { timeout: 10_000, retry: false } });
      this.accessToken = async () => (await jwt.getAccessToken()).token ?? "";
    }
  }

  async send(token: string, m: PushMessage): Promise<SendOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.cfg.projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: m.title, body: m.body },
            data: { url: m.url },
            android: { priority: "HIGH", notification: { channel_id: m.channel } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return "retry";
    }
    if (res.ok) return "ok";
    const body = (await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
    // Only FCM token errors retire a device; a bad project or malformed message must not erase good tokens.
    const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode;
    if (code === "UNREGISTERED" || (res.status === 400 && code === "INVALID_ARGUMENT")) return "dead";
    return "retry";
  }
}

export function fcmTransportFromEnv(env: Record<string, string | undefined> = process.env): FcmTransport | null {
  const projectId = env["FCM_PROJECT_ID"];
  const clientEmail = env["FCM_CLIENT_EMAIL"];
  const privateKey = env["FCM_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
  return projectId && clientEmail && privateKey ? new FcmTransport({ projectId, clientEmail, privateKey }) : null;
}
