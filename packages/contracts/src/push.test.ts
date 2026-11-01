import { describe, expect, it } from "vitest";
import { RegisterDeviceSchema } from "./app";
const sub = (token: string) => ({ platform: "WEBPUSH", token, p256dh: "valid-keys-for-test", auth: "auth-test-key" });
describe("Web Push endpoint validation", () => {
  it("accepts browser push services and rejects arbitrary outbound URLs", () => {
    for (const url of ["https://fcm.googleapis.com/fcm/send/a", "https://updates.push.services.mozilla.com/wpush/v2/a", "https://web.push.apple.com/Q/a"]) expect(RegisterDeviceSchema.safeParse(sub(url)).success).toBe(true);
    for (const url of ["not-url", "http://fcm.googleapis.com/a", "https://127.0.0.1/a", "https://localhost/a", "https://fcm.googleapis.com.evil.test/a", "https://user:pass@fcm.googleapis.com/a", "https://fcm.googleapis.com:444/a"]) expect(RegisterDeviceSchema.safeParse(sub(url)).success).toBe(false);
  });
});
