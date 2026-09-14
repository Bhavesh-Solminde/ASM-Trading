import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { prisma } from "@asm/db";
import { AssetRegistry } from "./assets/registry";
import { EngineServer } from "./server";

interface Reply {
  type: string;
  message?: string;
  candles?: Record<string, unknown>[];
}

const registry = new AssetRegistry(99);
let server: EngineServer;
let url = "";

beforeAll(async () => {
  await registry.load();
  // Port 0 = any free port. The authenticator is injected, so this test needs
  // no Redis: one known ticket maps to one user id.
  server = new EngineServer(registry, 0, async (ticket) =>
    ticket === "good-ticket" ? "user-under-test" : null,
  );
  await server.ready();
  url = `ws://127.0.0.1:${server.port()}`;
});

afterAll(async () => {
  await server.stop();
  await prisma.$disconnect();
});

/**
 * Opens a socket, sends every message back-to-back the instant it opens, and
 * collects replies until `count` arrive, the socket closes, or 3s pass.
 */
function exchange(
  messages: unknown[],
  count: number,
): Promise<{ replies: Reply[]; closeCode: number | null }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const replies: Reply[] = [];
    let closeCode: number | null = null;
    const finish = () => resolve({ replies, closeCode });
    const timer = setTimeout(() => {
      socket.terminate();
      finish();
    }, 3000);

    socket.on("open", () => {
      for (const message of messages) socket.send(JSON.stringify(message));
    });
    socket.on("message", (raw: WebSocket.RawData) => {
      replies.push(JSON.parse(raw.toString()) as Reply);
      if (replies.length >= count) {
        clearTimeout(timer);
        // Close and wait for the "close" listener below to resolve: closing
        // is a handshake, so the close event (and the real close code, which
        // may come from the server rather than this side) always arrives
        // asynchronously — resolving here instead would race it and capture
        // closeCode before the server's own close (e.g. 1008) is observed.
        socket.close();
      }
    });
    socket.on("close", (code: number) => {
      closeCode = code;
      clearTimeout(timer);
      finish();
    });
    socket.on("error", reject);
  });
}

describe("EngineServer", () => {
  it("processes a subscribe sent immediately after auth, without waiting for a reply", async () => {
    const { replies } = await exchange(
      [
        { type: "auth", token: "good-ticket" },
        { type: "subscribe", symbol: "AUDNZD_OTC", timeframe: "1m" },
      ],
      4,
    );
    expect(replies.map((r) => r.type)).toEqual([
      "ready",
      "authed",
      "candles:history",
      "payout:update",
    ]);
  });

  it("refuses to subscribe before authenticating", async () => {
    const { replies } = await exchange(
      [{ type: "subscribe", symbol: "AUDNZD_OTC", timeframe: "1m" }],
      2,
    );
    expect(replies[1]).toEqual({ type: "error", message: "Authenticate first." });
  });

  it("closes the socket with 1008 on an unknown ticket", async () => {
    const { replies, closeCode } = await exchange([{ type: "auth", token: "forged" }], 2);
    expect(replies[1]).toEqual({ type: "error", message: "Session expired." });
    expect(closeCode).toBe(1008);
  });

  it("rejects a message with an unknown type", async () => {
    const { replies } = await exchange([{ type: "hack" }], 2);
    expect(replies[1]).toEqual({ type: "error", message: "Unrecognised message." });
  });

  it("sends only OHLC fields in candle history — never shadow columns", async () => {
    const { replies } = await exchange(
      [
        { type: "auth", token: "good-ticket" },
        { type: "subscribe", symbol: "AUDNZD_OTC", timeframe: "1m" },
      ],
      3,
    );
    const history = replies.find((r) => r.type === "candles:history");
    for (const candle of history?.candles ?? []) {
      expect(Object.keys(candle).sort()).toEqual(["c", "h", "l", "o", "openTs"]);
    }
  });
});
