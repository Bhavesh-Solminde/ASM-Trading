import { describe, expect, it, vi } from "vitest";
import { WebPushTransport } from "./webpush";

const sub = { endpoint: "https://push.example/abc", p256dh: "k", auth: "a" };
const msg = { title: "T", body: "B", url: "/history", channel: "payments" as const };

describe("WebPushTransport", () => {
  it("sends a JSON payload the service worker can show", async () => {
    const sendNotification = vi.fn<typeof import("web-push").sendNotification>(async () => ({ statusCode: 201, body: "", headers: {} }));
    const t = new WebPushTransport({ publicKey: "pub", privateKey: "priv", subject: "mailto:x@y.z" }, { sendNotification });
    expect(await t.send(sub, msg)).toBe("ok");
    expect(JSON.parse(sendNotification.mock.calls[0]![1] as string)).toEqual({ title: "T", body: "B", url: "/history" });
  });
  it("treats 404/410 as a dead subscription", async () => {
    const err = Object.assign(new Error("gone"), { statusCode: 410 });
    const t = new WebPushTransport({ publicKey: "p", privateKey: "q", subject: "mailto:x@y.z" }, { sendNotification: vi.fn(async () => { throw err; }) });
    expect(await t.send(sub, msg)).toBe("dead");
  });
});
