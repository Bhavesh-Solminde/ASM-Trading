import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateGatewayAddressIndex, createAccountsForUser, createGatewayUsdtDeposit, prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { POST } from "./route";

const SECRET = "test-hmac-secret";
const CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const SENDER_HEX = "d3682962027e721c5247a9faf7865fe4a71d5438"; // TVF2Mp9QY7FEGTnr3DBpFLobA6jguHyMvi
const CONTRACT_HEX = "42a1e39aefa49290f2b3f9ed688d7cecf86cd6e0";
const TRANSFER = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// A real derived Shasta address (index 0 of a throwaway testnet xpub).
const ADDRESS = "TDTGBGVwuKQ6G3zPDhPCqqGvdfGgVdQREr";
const ADDRESS_HEX = "2636acecc381165bf1c02c4c255d75ac443c4685";

let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `tatum-webhook-${randomUUID()}@test.local`, passwordHash: "x" } });
  userId = user.id;
  await createAccountsForUser(userId, 0, "USD");
});

afterAll(async () => {
  const deps = await prisma.deposit.findMany({ where: { userId }, select: { id: true } });
  await prisma.chainCredit.deleteMany({ where: { toAddress: ADDRESS } });
  await prisma.auditLog.deleteMany({ where: { targetType: "Deposit", targetId: { in: deps.map((d) => d.id) } } });
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => {
  vi.stubEnv("USDT_DEPOSIT_PROVIDER", "tatum");
  vi.stubEnv("TATUM_API_KEY", "t-test-key");
  vi.stubEnv("TATUM_NETWORK", "testnet");
  vi.stubEnv("TATUM_TRON_XPUB", "xpub-test");
  vi.stubEnv("TATUM_TRON_USDT_CONTRACT", CONTRACT);
  vi.stubEnv("TATUM_WEBHOOK_URL", "https://example.test/api/webhooks/tatum");
  vi.stubEnv("TATUM_WEBHOOK_HMAC_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function sign(body: unknown, secret = SECRET): string {
  return createHmac("sha512", secret).update(JSON.stringify(body)).digest("base64");
}

function call(body: unknown, signature: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": randomUUID() };
  if (signature) headers["x-payload-hash"] = signature;
  return POST(new NextRequest("http://localhost/api/webhooks/tatum", { method: "POST", headers, body: JSON.stringify(body) }));
}

/** Fake Tatum: a final, successful tx paying `rawUsdt` (6dp) of our token to ADDRESS. */
function stubTatumTx(txId: string, rawUsdt: bigint): void {
  const tx = {
    txID: txId,
    blockNumber: 70_000_000,
    ret: [{ contractRet: "SUCCESS" }],
    log: [
      {
        address: CONTRACT_HEX,
        topics: [TRANSFER, `000000000000000000000000${SENDER_HEX}`, `000000000000000000000000${ADDRESS_HEX}`],
        data: rawUsdt.toString(16).padStart(64, "0"),
      },
    ],
  };
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url === `https://api.tatum.io/v3/tron/transaction/${txId}`) return ok(tx);
    if (url === "https://api.tatum.io/v3/tron/info") return ok({ blockNumber: 70_000_100 });
    if (url === "https://api.tatum.io/v3/tron/block/70000000") return ok({ timestamp: Date.now() });
    if (url.startsWith("https://api.tatum.io/v4/subscription/")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
  });
}

describe("POST /api/webhooks/tatum", () => {
  it("rejects a missing or wrong signature", async () => {
    const body = { address: ADDRESS, txId: "a".repeat(64), chain: "tron-testnet" };
    expect((await call(body, null)).status).toBe(401);
    expect((await call(body, sign(body, "wrong"))).status).toBe(401);
  });

  it("fails closed when no HMAC secret is configured", async () => {
    vi.stubEnv("TATUM_WEBHOOK_HMAC_SECRET", "");
    vi.stubEnv("TATUM_WEBHOOK_URL", "");
    const body = { address: ADDRESS, txId: "a".repeat(64), chain: "tron-testnet" };
    expect((await call(body, sign(body, ""))).status).toBe(401);
  });

  it("acknowledges (200) a signed event for an address no deposit owns", async () => {
    const body = { address: "TNobody111111111111111111111111111", txId: "a".repeat(64), chain: "tron-testnet" };
    const res = await call(body, sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "address" });
  });

  it("ignores a signed event for the other environment's chain", async () => {
    const body = { address: ADDRESS, txId: "a".repeat(64), chain: "tron-mainnet" };
    expect(await (await call(body, sign(body))).json()).toMatchObject({ ignored: "chain" });
  });

  it("verifies the tx on-chain and credits the deposit — ignoring the amount claimed in the body", async () => {
    const deposit = await createGatewayUsdtDeposit({
      userId,
      amountUsdtMinorRequested: 2_000,
      network: "tron",
      tokenContract: CONTRACT,
      receivingAddress: ADDRESS,
      addressIndex: await allocateGatewayAddressIndex(`tron-webhook-test-${randomUUID()}`),
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({ where: { id: deposit.id }, data: { gatewaySubscriptionId: "sub-1" } });
    const txId = randomUUID().replace(/-/g, "").padEnd(64, "0");
    stubTatumTx(txId, 20_000_000n); // 20.00 USDT on-chain

    // The body lies about the amount; it must not matter.
    const body = { address: ADDRESS, txId, chain: "tron-testnet", amount: "999999", counterAddress: "TFake" };
    const res = await call(body, sign(body));
    expect(res.status).toBe(200);

    const after = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.amountUsdtMinor).toBe(2_000);
    expect(after.gatewaySubscriptionId).toBeNull(); // alert released
    const acct = await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
    expect(acct.realBalance).toBe(2_000);

    // A Tatum retry of the same notification credits nothing more.
    expect((await call(body, sign(body))).status).toBe(200);
    expect((await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).realBalance).toBe(2_000);
  });
});
