// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";
import { syncExistingWebPush, unregisterWebPush } from "@/lib/web-push-client";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function browser() {
  const endpoint = "https://web.push.apple.com/token";
  const subscription = {
    endpoint,
    toJSON: () => ({
      endpoint,
      keys: { p256dh: "public-key", auth: "auth-key" },
    }),
    unsubscribe: vi.fn(async () => true),
  };
  const registration = {
    pushManager: { getSubscription: vi.fn(async () => subscription) },
  };
  const register = vi.fn(async () => registration);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register,
      getRegistration: vi.fn(async () => registration),
    },
    standalone: true,
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  return { subscription, register };
}

describe("installed browser push ownership", () => {
  it("rebinds A's persisted endpoint on B's authenticated entry after A expires, without opening the toggle", async () => {
    const { register, subscription } = browser();
    let cookie = "A",
      owner = "A";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts: RequestInit) => {
        expect(JSON.parse(opts.body as string).token).toBe(
          subscription.endpoint,
        );
        if (!cookie) return new Response(null, { status: 401 });
        owner = cookie;
        return new Response(null, { status: 204 });
      }),
    );
    const view = render(
      createElement(ServiceWorkerRegistrar, { sessionKey: "A" }),
    );
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    // The cookie expires while the installed app is closed. B signs in with the same browser subscription.
    cookie = "B";
    view.rerender(createElement(ServiceWorkerRegistrar, { sessionKey: "B" }));
    await waitFor(() => expect(owner).toBe("B"));
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
  it("unsubscribes instead of reporting On when the current cookie is expired", async () => {
    const { subscription } = browser();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    expect(await syncExistingWebPush()).toBe(false);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
  it("bounds logout cleanup even when service-worker discovery never completes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: () => new Promise(() => {}) },
    });
    const finished = vi.fn();
    const pending = unregisterWebPush().then(finished);
    await vi.advanceTimersByTimeAsync(2999);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(finished).toHaveBeenCalledOnce();
  });
});
