import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  runInNewContext(
    readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"),
    {
      URL,
      self: {
        location: { origin: "https://indianxtrade.com" },
        addEventListener: (
          name: string,
          handler: (event: Record<string, unknown>) => void,
        ) => handlers.set(name, handler),
        registration: { showNotification },
        clients: { matchAll: async () => [], openWindow },
      },
    },
  );
  return { handlers, showNotification, openWindow };
}

describe("push-only service worker", () => {
  it("never intercepts or caches balance/trade fetches", () => {
    expect(worker().handlers.has("fetch")).toBe(false);
  });
  it("rechecks tap URLs rather than trusting external or protocol-relative payloads", async () => {
    const { handlers, openWindow } = worker();
    for (const url of [
      "https://evil.test/phish",
      "//evil.test/phish",
      "javascript:alert(1)",
    ]) {
      let pending: Promise<unknown> | undefined;
      handlers.get("notificationclick")!({
        notification: { close() {}, data: { url } },
        waitUntil: (p: Promise<unknown>) => {
          pending = p;
        },
      });
      await pending;
      expect(openWindow).toHaveBeenLastCalledWith(
        "https://indianxtrade.com/history",
      );
    }
  });
  it("preserves valid payment deep links and handles malformed push JSON", async () => {
    const { handlers, showNotification } = worker();
    let pending: Promise<unknown> | undefined;
    handlers.get("push")!({
      data: { json: () => ({ title: "Payment", url: "/history?tx=d:1" }) },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
    expect(showNotification).toHaveBeenLastCalledWith(
      "Payment",
      expect.objectContaining({
        data: { url: "https://indianxtrade.com/history?tx=d:1" },
      }),
    );
    expect(() =>
      handlers.get("push")!({
        data: {
          json: () => {
            throw Error();
          },
        },
        waitUntil() {},
      }),
    ).not.toThrow();
  });
});
