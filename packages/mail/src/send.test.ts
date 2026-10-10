import { describe, expect, it, vi } from "vitest";

vi.mock("@asm/logger", () => ({ childLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { isDeliverableAddress, sendEmail, type SendDeps } from "./send";

const LIVE_ENV = {
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "IndianxTrade <no-reply@indianxtrade.com>",
  RESEND_REPLY_TO: "support@indianxtrade.com",
};
const MSG = { to: "asha@gmail.com", subject: "Hello", html: "<p>Hello</p>" };

function setup(responses: Array<Response | Error>, env: Record<string, string | undefined> = LIVE_ENV) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: SendDeps = { fetch: fetchMock as unknown as typeof fetch, env, sleep: async () => {} };
  return { fetchMock, deps };
}

const ok = () => new Response(JSON.stringify({ id: "em_123" }), { status: 200 });

describe("isDeliverableAddress", () => {
  it("accepts a real mailbox", () => {
    expect(isDeliverableAddress("asha@gmail.com")).toBe(true);
  });
  it("rejects seed and test domains", () => {
    expect(isDeliverableAddress("test1@asmtrade.local")).toBe(false);
    expect(isDeliverableAddress("a@test.local")).toBe(false);
    expect(isDeliverableAddress("a@example.com")).toBe(false);
    expect(isDeliverableAddress("a@foo.test")).toBe(false);
    expect(isDeliverableAddress("not-an-email")).toBe(false);
  });
});

describe("sendEmail", () => {
  it("never sends under vitest, even with a key", async () => {
    const { fetchMock, deps } = setup([ok()], { ...LIVE_ENV, VITEST: "true" });
    expect(await sendEmail(MSG, deps)).toEqual({ ok: false, skipped: true, reason: "test_env" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips when RESEND_API_KEY is unset", async () => {
    const { fetchMock, deps } = setup([ok()], {});
    expect(await sendEmail(MSG, deps)).toEqual({ ok: false, skipped: true, reason: "no_api_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a reserved test address", async () => {
    const { fetchMock, deps } = setup([ok()]);
    const result = await sendEmail({ ...MSG, to: "test1@asmtrade.local" }, deps);
    expect(result).toEqual({ ok: false, skipped: true, reason: "undeliverable_address" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts from, to, reply_to, tag and the idempotency key", async () => {
    const { fetchMock, deps } = setup([ok()]);
    const result = await sendEmail({ ...MSG, idempotencyKey: "deposit-credited/abc", tag: "deposit_credited" }, deps);
    expect(result).toEqual({ ok: true, id: "em_123" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("deposit-credited/abc");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "IndianxTrade <no-reply@indianxtrade.com>",
      to: ["asha@gmail.com"],
      subject: "Hello",
      html: "<p>Hello</p>",
      reply_to: "support@indianxtrade.com",
      tags: [{ name: "category", value: "deposit_credited" }],
    });
  });

  it("falls back to Resend's sandbox sender when RESEND_FROM is unset", async () => {
    const { fetchMock, deps } = setup([ok()], { RESEND_API_KEY: "re_test_key" });
    await sendEmail(MSG, deps);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body)).from).toBe("IndianxTrade <onboarding@resend.dev>");
  });

  it("does not retry a 4xx rejection", async () => {
    const { fetchMock, deps } = setup([new Response("invalid from", { status: 422 }), ok()]);
    const result = await sendEmail({ ...MSG, idempotencyKey: "k" }, deps);
    expect(result).toEqual({ ok: false, skipped: false, error: "invalid from" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx once when an idempotency key makes it safe", async () => {
    const { fetchMock, deps } = setup([new Response("busy", { status: 503 }), ok()]);
    expect(await sendEmail({ ...MSG, idempotencyKey: "k" }, deps)).toEqual({ ok: true, id: "em_123" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry without an idempotency key", async () => {
    const { fetchMock, deps } = setup([new Response("busy", { status: 503 }), ok()]);
    expect((await sendEmail(MSG, deps)).ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a network failure without throwing", async () => {
    const { deps } = setup([new Error("ECONNRESET"), new Error("ECONNRESET")]);
    expect(await sendEmail({ ...MSG, idempotencyKey: "k" }, deps)).toEqual({ ok: false, skipped: false, error: "network" });
  });
});
