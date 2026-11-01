import { describe, expect, it } from "vitest";
import { deviceBody, urlBase64ToUint8Array } from "./web-push-client";
describe("push serialization", () => {
  it("decodes URL-safe VAPID keys", () =>
    expect([...urlBase64ToUint8Array("AQID_-8")]).toEqual([1, 2, 3, 255, 239]));
  it("requires endpoint and keys", () => {
    expect(
      deviceBody({
        endpoint: "https://push.example/x",
        keys: { p256dh: "pk", auth: "au" },
      }),
    ).toEqual({
      platform: "WEBPUSH",
      token: "https://push.example/x",
      p256dh: "pk",
      auth: "au",
    });
    expect(deviceBody({ endpoint: "https://push.example/x" })).toBeNull();
    expect(
      deviceBody({
        endpoint: "http://push.example/x",
        keys: { p256dh: "a", auth: "b" },
      }),
    ).toBeNull();
  });
});
