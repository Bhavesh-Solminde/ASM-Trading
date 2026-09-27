import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { GET, POST } from "./route";

const RUN = randomUUID();
let userId = "";
let cookie = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `deposit-route-${RUN}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  cookie = await createSession(userId, {});
});

afterAll(async () => {
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

// The route reads USDT_* config from process.env fresh on every request, so
// tests pin it explicitly with vi.stubEnv rather than depending on whatever
// this machine's own .env happens to have — the USDT tests must pass the
// same way locally and in CI regardless of ambient chain-watcher config.
afterEach(() => {
  vi.unstubAllEnvs();
});

function headers(sessionCookie: string | null): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": randomUUID() };
  if (sessionCookie) h["cookie"] = `${SESSION_COOKIE}=${sessionCookie}`;
  return h;
}

function post(body: unknown, sessionCookie: string | null): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/deposits", {
      method: "POST",
      headers: headers(sessionCookie),
      body: JSON.stringify(body),
    }),
  );
}

function get(sessionCookie: string | null): Promise<Response> {
  return GET(new NextRequest("http://localhost/api/deposits", { headers: headers(sessionCookie) }));
}

describe("POST /api/deposits", () => {
  it("requires a session", async () => {
    expect((await post({ method: "PhonePe", amountInr: 100_000 }, null)).status).toBe(401);
  });

  it("creates a deposit intent and returns a checkout token", async () => {
    const res = await post({ method: "PhonePe", amountInr: 100_000 }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { checkoutToken: string };
    expect(typeof body.checkoutToken).toBe("string");
    expect(body.checkoutToken.length).toBeGreaterThan(0);
  });

  it("rejects a payload that doesn't match either branch of the discriminated union", async () => {
    const res = await post({ method: "PhonePe", amountUsdtMinor: 1500 }, cookie);
    expect(res.status).toBe(400);
  });

  it("refuses a USDT deposit when the chain watcher isn't configured", async () => {
    vi.stubEnv("USDT_NETWORK", "");
    vi.stubEnv("USDT_TRONGRID_NETWORK", "");
    vi.stubEnv("USDT_TOKEN_CONTRACT", "");
    vi.stubEnv("USDT_RECEIVING_ADDRESS", "");
    const res = await post({ method: "USDT", amountUsdtMinor: 1500 }, cookie);
    expect(res.status).toBe(503);
  });

  it("creates a USDT deposit intent when the chain watcher is configured", async () => {
    vi.stubEnv("USDT_NETWORK", "tron");
    vi.stubEnv("USDT_TRONGRID_NETWORK", "nile");
    vi.stubEnv("USDT_TOKEN_CONTRACT", "TTestContract11111111111111111111");
    vi.stubEnv("USDT_RECEIVING_ADDRESS", "TTestReceiving111111111111111111");
    const res = await post({ method: "USDT", amountUsdtMinor: 1500 }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { checkoutToken: string };
    expect(typeof body.checkoutToken).toBe("string");
  });

  it("refuses a USDT deposit whose USDT_TRONGRID_NETWORK is neither mainnet nor nile", async () => {
    vi.stubEnv("USDT_NETWORK", "tron");
    vi.stubEnv("USDT_TRONGRID_NETWORK", "shasta");
    vi.stubEnv("USDT_TOKEN_CONTRACT", "TTestContract11111111111111111111");
    vi.stubEnv("USDT_RECEIVING_ADDRESS", "TTestReceiving111111111111111111");
    const res = await post({ method: "USDT", amountUsdtMinor: 1500 }, cookie);
    expect(res.status).toBe(503);
  });
});

describe("GET /api/deposits", () => {
  it("requires a session", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("lists the caller's own deposits, with USDT fields null for an INR deposit", async () => {
    const res = await get(cookie);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      deposits: { method: string; amountInr: number; amountUsdtMinor: number | null; network: string | null }[];
    };
    expect(body.deposits.length).toBeGreaterThanOrEqual(1);
    const phonepe = body.deposits.find((d) => d.method === "PhonePe");
    expect(phonepe).toMatchObject({ amountUsdtMinor: null, network: null });
  });
});
