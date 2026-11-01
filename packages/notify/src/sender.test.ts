import { describe, expect, it, vi } from "vitest";
import { PushSender } from "./sender";

const device = (over: Record<string, unknown>) => ({ id: "x", userId: "u", platform: "ANDROID", token: "t1", p256dh: null, auth: null, locale: "hi", createdAt: new Date(), lastSeenAt: new Date(), ...over }) as never;

describe("PushSender", () => {
  it("renders per device locale and drops dead tokens", async () => {
    const fcm = { send: vi.fn(async (token: string) => (token === "dead" ? "dead" : "ok")) };
    const dropToken = vi.fn(async () => {});
    const sender = new PushSender({
      fcm: fcm as never,
      web: null,
      devices: async () => [device({ token: "t1" }), device({ token: "dead", locale: "en" })],
      dropToken,
    });
    const render = vi.fn((locale: string) => ({ title: locale, body: "b", url: "/", channel: "trades" as const }));
    const out = await sender.sendToUser("u", render);
    expect(out).toEqual({ delivered: 1, retry: false });
    expect(render).toHaveBeenCalledWith("hi", "ANDROID");
    expect(dropToken).toHaveBeenCalledWith("dead");
  });
  it("skips web push devices when no VAPID keys are configured", async () => {
    const sender = new PushSender({ fcm: null, web: null, devices: async () => [device({ platform: "WEBPUSH" })], dropToken: vi.fn() });
    expect(await sender.sendToUser("u", () => ({ title: "", body: "", url: "/", channel: "trades" }))).toEqual({ delivered: 0, retry: false, deferred: true });
  });
});
