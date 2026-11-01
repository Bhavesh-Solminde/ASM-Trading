import { describe, expect, it, vi } from "vitest";
import { FcmTransport } from "./fcm";

const msg = { title: "T", body: "B", url: "/history", channel: "trades" as const };
const make = (status: number, body: unknown) => {
  const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status }));
  return { fetch: fetchMock, t: new FcmTransport({ projectId: "p", clientEmail: "e", privateKey: "k" }, { fetch: fetchMock, getAccessToken: async () => "at" }) };
};

describe("FcmTransport", () => {
  it("posts an HTTP v1 message with the channel and url", async () => {
    const { fetch, t } = make(200, { name: "projects/p/messages/1" });
    expect(await t.send("tok", msg)).toBe("ok");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://fcm.googleapis.com/v1/projects/p/messages:send");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.message).toMatchObject({
      token: "tok",
      notification: { title: "T", body: "B" },
      data: { url: "/history" },
      android: { notification: { channel_id: "trades" } },
    });
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer at" });
  });
  it("reports unregistered tokens as dead", async () => {
    expect(await make(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }).t.send("tok", msg)).toBe("dead");
  });
  it("retries on server errors", async () => {
    expect(await make(503, {}).t.send("tok", msg)).toBe("retry");
  });
});

it("keeps valid devices on project errors or a malformed message", async () => {
  expect(await make(404, { error: { status: "NOT_FOUND" } }).t.send("tok", msg)).toBe("retry");
  expect(await make(400, { error: { status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message" }] }] } }).t.send("tok", msg)).toBe("retry");
  expect(await make(400, { error: { details: [{ errorCode: "INVALID_ARGUMENT" }] } }).t.send("tok", msg)).toBe("dead");
});
