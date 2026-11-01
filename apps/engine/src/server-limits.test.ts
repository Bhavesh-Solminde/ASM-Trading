import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { AssetRegistry } from "./assets/registry";
import { EngineServer } from "./server";

// Auth and connection limits never touch the asset registry, so it stays unloaded.
let server: EngineServer;
let url = "";

beforeAll(async () => {
  server = new EngineServer(new AssetRegistry(7), 0, async (t) => (t === "good" ? "user-1" : null), {
    authTimeoutMs: 200,
    maxSocketsPerUser: 2,
  });
  await server.ready();
  url = `ws://127.0.0.1:${server.port()}`;
});

afterAll(async () => {
  await server.stop();
});

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(url);
    s.once("open", () => resolve(s));
    s.once("error", reject);
  });
}

function closed(s: WebSocket, withinMs = 2000): Promise<{ code: number; reason: string } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), withinMs);
    s.once("close", (code: number, reason: Buffer) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function authed(s: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    s.on("message", (raw: WebSocket.RawData) => {
      if ((JSON.parse(raw.toString()) as { type: string }).type === "authed") resolve();
    });
    s.send(JSON.stringify({ type: "auth", token: "good" }));
  });
}

describe("EngineServer limits", () => {
  it("closes a socket that never authenticates", async () => {
    const s = await open();
    expect(await closed(s)).toEqual({ code: 1008, reason: "Unauthorised" });
  });

  it("keeps an authenticated socket open past the auth deadline", async () => {
    const s = await open();
    await authed(s);
    expect(await closed(s, 400)).toBeNull();
    s.close();
  });

  it("evicts a user's oldest socket once they exceed the cap", async () => {
    const first = await open();
    await authed(first);
    const firstClosed = closed(first);
    const second = await open();
    await authed(second);
    const third = await open();
    await authed(third);
    expect(await firstClosed).toEqual({ code: 1008, reason: "Too many connections" });
    expect(second.readyState).toBe(WebSocket.OPEN);
    second.close();
    third.close();
  });

  it("drops a frame larger than the payload cap", async () => {
    const s = await open();
    const done = closed(s);
    s.send("x".repeat(64 * 1024));
    expect((await done)?.code).toBe(1009);
  });
});
