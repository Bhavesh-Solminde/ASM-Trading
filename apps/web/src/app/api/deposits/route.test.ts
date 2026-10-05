import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
// The suites below exercise the MANUAL provider (shared address + unique
// amount); the Tatum gateway describe re-stubs it to "tatum" itself.
beforeEach(() => {
  vi.stubEnv("USDT_DEPOSIT_PROVIDER", "manual");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubTron(): void {
  vi.stubEnv("USDT_NETWORK", "tron");
  vi.stubEnv("USDT_TRONGRID_NETWORK", "nile");
  vi.stubEnv("USDT_TOKEN_CONTRACT", "TTestContract11111111111111111111");
  vi.stubEnv("USDT_RECEIVING_ADDRESS", "TTestReceiving111111111111111111");
}

function clearTron(): void {
  vi.stubEnv("USDT_NETWORK", "");
  vi.stubEnv("USDT_TRONGRID_NETWORK", "");
  vi.stubEnv("USDT_TOKEN_CONTRACT", "");
  vi.stubEnv("USDT_RECEIVING_ADDRESS", "");
}

// Mixed case on purpose: the route must store EVM addresses lowercase.
const BSC_RECEIVING = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const BSC_CONTRACT = "0x1234567890ABCDEF1234567890abcdef12345678";

function stubBsc(): void {
  vi.stubEnv("USDT_BSC_CHAIN_ID", "97");
  vi.stubEnv("USDT_BSC_RPC_URL", "https://bsc-testnet.example.invalid");
  vi.stubEnv("USDT_BSC_RECEIVING_ADDRESS", BSC_RECEIVING);
  vi.stubEnv("USDT_BSC_TOKEN_CONTRACT", BSC_CONTRACT);
  vi.stubEnv("USDT_BSC_TOKEN_DECIMALS", "18");
}

function clearBsc(): void {
  vi.stubEnv("USDT_BSC_CHAIN_ID", "");
  vi.stubEnv("USDT_BSC_RPC_URL", "");
  vi.stubEnv("USDT_BSC_RECEIVING_ADDRESS", "");
  vi.stubEnv("USDT_BSC_TOKEN_CONTRACT", "");
  vi.stubEnv("USDT_BSC_TOKEN_DECIMALS", "");
}

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
    clearTron();
    clearBsc();
    const res = await post({ method: "USDT", network: "tron", amountUsdtMinor: 1500 }, cookie);
    expect(res.status).toBe(503);
  });

  it("rejects a USDT deposit without a network", async () => {
    stubTron();
    stubBsc();
    const res = await post({ method: "USDT", amountUsdtMinor: 1500 }, cookie);
    expect(res.status).toBe(400);
  });

  it("creates a USDT deposit intent when the chain watcher is configured", async () => {
    stubTron();
    clearBsc();
    const res = await post({ method: "USDT", network: "tron", amountUsdtMinor: 1500 }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { checkoutToken: string };
    expect(typeof body.checkoutToken).toBe("string");
    const row = await prisma.deposit.findUniqueOrThrow({ where: { checkoutToken: body.checkoutToken } });
    expect(row.network).toBe("tron");
  });

  it("refuses a USDT deposit whose USDT_TRONGRID_NETWORK is neither mainnet nor nile", async () => {
    stubTron();
    vi.stubEnv("USDT_TRONGRID_NETWORK", "shasta");
    const res = await post({ method: "USDT", network: "tron", amountUsdtMinor: 1500 }, cookie);
    expect(res.status).toBe(503);
  });

  it("creates a BSC deposit on the BSC config, with lowercase EVM addresses", async () => {
    clearTron();
    stubBsc();
    const res = await post({ method: "USDT", network: "bsc", amountUsdtMinor: 1600 }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { checkoutToken: string };
    const row = await prisma.deposit.findUniqueOrThrow({ where: { checkoutToken: body.checkoutToken } });
    expect(row.network).toBe("bsc");
    expect(row.receivingAddress).toBe(BSC_RECEIVING.toLowerCase());
    expect(row.tokenContract).toBe(BSC_CONTRACT.toLowerCase());
  });

  it("refuses a BSC deposit when only TRON is configured", async () => {
    stubTron();
    clearBsc();
    const res = await post({ method: "USDT", network: "bsc", amountUsdtMinor: 1600 }, cookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("BNB Smart Chain");
  });

  it("refuses a BSC deposit whose chain id is not 56 or 97 (never defaults to mainnet)", async () => {
    stubBsc();
    vi.stubEnv("USDT_BSC_CHAIN_ID", "1");
    const res = await post({ method: "USDT", network: "bsc", amountUsdtMinor: 1600 }, cookie);
    expect(res.status).toBe(503);
  });

  it("refuses a BSC deposit when token decimals are missing", async () => {
    stubBsc();
    vi.stubEnv("USDT_BSC_TOKEN_DECIMALS", "");
    const res = await post({ method: "USDT", network: "bsc", amountUsdtMinor: 1600 }, cookie);
    expect(res.status).toBe(503);
  });
});

describe("POST /api/deposits — Tatum gateway provider", () => {
  const TRON_CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
  const DERIVED = "TDTGBGVwuKQ6G3zPDhPCqqGvdfGgVdQREr";
  let tatumCalls: string[] = [];
  // Own user: the route rate-limits deposits per user (10 / 5 min), and the
  // manual-provider suite above already spends most of that budget.
  let gwUserId = "";
  let gwCookie = "";

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `deposit-route-gw-${RUN}@test.local`, passwordHash: "x" } });
    gwUserId = user.id;
    gwCookie = await createSession(gwUserId, {});
  });

  afterAll(async () => {
    await prisma.deposit.deleteMany({ where: { userId: gwUserId } });
    await prisma.user.deleteMany({ where: { id: gwUserId } });
  });

  function stubGateway(extra: Record<string, string> = {}): void {
    vi.stubEnv("USDT_DEPOSIT_PROVIDER", "tatum");
    vi.stubEnv("TATUM_API_KEY", "t-test-key");
    vi.stubEnv("TATUM_NETWORK", "testnet");
    vi.stubEnv("TATUM_TRON_XPUB", "xpub-test");
    vi.stubEnv("TATUM_TRON_USDT_CONTRACT", TRON_CONTRACT);
    vi.stubEnv("TATUM_BSC_XPUB", "");
    vi.stubEnv("TATUM_WEBHOOK_URL", "");
    vi.stubEnv("TATUM_WEBHOOK_HMAC_SECRET", "");
    for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
    tatumCalls = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      tatumCalls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("https://api.tatum.io/v3/tron/address/xpub-test/")) {
        return new Response(JSON.stringify({ address: DERIVED }), { status: 200 });
      }
      if (url.startsWith("https://api.tatum.io/v4/subscription")) {
        return new Response(JSON.stringify({ id: "sub-123" }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
    });
  }

  it("issues a fresh derived address and stores the exact requested amount", async () => {
    stubGateway();
    const res = await post({ method: "USDT", network: "tron", amountUsdtMinor: 5_000 }, gwCookie);
    expect(res.status).toBe(201);
    const { checkoutToken } = (await res.json()) as { checkoutToken: string };
    const row = await prisma.deposit.findUniqueOrThrow({ where: { checkoutToken } });
    expect(row).toMatchObject({
      gateway: "TATUM",
      network: "tron",
      tokenContract: TRON_CONTRACT,
      receivingAddress: DERIVED,
      amountUsdtMinor: 5_000,
      gatewaySubscriptionId: null,
    });
    expect(row.gatewayAddressIndex).toBeGreaterThanOrEqual(1);
    expect(tatumCalls).toEqual([`GET https://api.tatum.io/v3/tron/address/xpub-test/${row.gatewayAddressIndex}`]);
  });

  it("creates a Tatum alert when a webhook URL is configured", async () => {
    stubGateway({ TATUM_WEBHOOK_URL: "https://example.test/api/webhooks/tatum", TATUM_WEBHOOK_HMAC_SECRET: "s" });
    const res = await post({ method: "USDT", network: "tron", amountUsdtMinor: 5_000 }, gwCookie);
    expect(res.status).toBe(201);
    const { checkoutToken } = (await res.json()) as { checkoutToken: string };
    expect((await prisma.deposit.findUniqueOrThrow({ where: { checkoutToken } })).gatewaySubscriptionId).toBe("sub-123");
    expect(tatumCalls.some((c) => c.startsWith("POST https://api.tatum.io/v4/subscription?type=testnet"))).toBe(true);
  });

  it("refuses a network the gateway is not configured for, and out-of-range amounts without calling Tatum", async () => {
    stubGateway();
    expect((await post({ method: "USDT", network: "bsc", amountUsdtMinor: 5_000 }, gwCookie)).status).toBe(503);
    expect((await post({ method: "USDT", network: "tron", amountUsdtMinor: 50 }, gwCookie)).status).toBe(400);
    expect(tatumCalls).toEqual([]);
  });

  it("answers 503 (and writes nothing) when Tatum cannot derive an address", async () => {
    stubGateway({ TATUM_TRON_XPUB: "xpub-broken" });
    const before = await prisma.deposit.count({ where: { userId: gwUserId } });
    expect((await post({ method: "USDT", network: "tron", amountUsdtMinor: 5_000 }, gwCookie)).status).toBe(503);
    expect(await prisma.deposit.count({ where: { userId: gwUserId } })).toBe(before);
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
