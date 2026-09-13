import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_VPA, createAccountsForUser, createDepositIntent, prisma } from "@asm/db";
import { POST } from "./route";

// Falls back to a fixed test value only if the real environment (loaded via
// dotenv from the repo's .env, same as every other DB-touching test in this
// codebase) hasn't already set one.
const TEST_SECRET = process.env["SMS_RELAY_SECRET"] ?? "test-only-sms-relay-secret";

const DEVICE_LABEL = `route-test-${randomUUID()}`;

/**
 * Mirrors `syntheticUtr` in `./route.ts` exactly (not imported — Next.js
 * route files only export HTTP-method handlers, so this is intentionally
 * duplicated). Lets the recovery test manufacture the exact DB state a
 * crashed prior attempt would have left behind: an unconsumed BankCredit
 * already sitting at the UTR a fresh, identical request would deterministically
 * hash to.
 */
function expectedSyntheticUtr(sender: string | null, body: string, receivedAt: Date): string {
  const hash = createHash("sha256")
    .update(`${sender ?? ""}|${body}|${receivedAt.toISOString()}`)
    .digest("hex")
    .slice(0, 24);
  return `no-utr-${hash}`;
}

function relayRequest(input: {
  rawBody?: string;
  body?: Record<string, unknown> | null;
  authorization?: string | null;
}): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.authorization !== null) {
    headers["authorization"] = input.authorization ?? `Bearer ${TEST_SECRET}`;
  }
  const body = input.rawBody ?? (input.body === undefined ? "{}" : JSON.stringify(input.body));
  return new NextRequest("http://localhost/api/bank-feed/sms", {
    method: "POST",
    headers,
    body,
  });
}

async function latestRelayMessage(deviceLabel: string) {
  return prisma.relayMessage.findFirst({
    where: { deviceLabel },
    orderBy: { createdAt: "desc" },
  });
}

async function countRelayMessages(deviceLabel: string): Promise<number> {
  return prisma.relayMessage.count({ where: { deviceLabel } });
}

let userId = "";
const createdBankCreditIds: string[] = [];

beforeAll(async () => {
  process.env["SMS_RELAY_SECRET"] = TEST_SECRET;

  const user = await prisma.user.create({
    data: { email: `bankfeed-route-test-${Date.now()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.relayMessage.deleteMany({ where: { deviceLabel: DEVICE_LABEL } });
  await prisma.bankCredit.deleteMany({ where: { id: { in: createdBankCreditIds } } });
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("POST /api/bank-feed/sms", () => {
  it("rejects a request with a missing or wrong Bearer token", async () => {
    const label = `${DEVICE_LABEL}-unauth`;

    const noAuthRes = await POST(
      relayRequest({
        authorization: null,
        body: { sender: "SBI", body: "irrelevant", deviceLabel: label },
      }),
    );
    expect(noAuthRes.status).toBe(401);

    const wrongAuthRes = await POST(
      relayRequest({
        authorization: "Bearer definitely-not-the-secret",
        body: { sender: "SBI", body: "irrelevant", deviceLabel: label },
      }),
    );
    expect(wrongAuthRes.status).toBe(401);

    expect(await countRelayMessages(label)).toBe(0);
  });

  it("rejects a malformed body (invalid JSON, and JSON missing the body field)", async () => {
    const notJsonRes = await POST(relayRequest({ rawBody: "not json at all" }));
    expect(notJsonRes.status).toBe(400);

    const label = `${DEVICE_LABEL}-malformed`;
    const missingFieldRes = await POST(
      relayRequest({ body: { sender: "SBI", deviceLabel: label } }),
    );
    expect(missingFieldRes.status).toBe(400);

    expect(await countRelayMessages(label)).toBe(0);
  });

  it("logs but ignores a non-credit (debit) message, creating no BankCredit", async () => {
    const label = `${DEVICE_LABEL}-debit`;
    const res = await POST(
      relayRequest({
        body: {
          sender: "SBI",
          body: "Rs.500.00 debited from A/c XX1234 for purchase at Amazon.",
          deviceLabel: label,
        },
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, matched: false });

    const relayMessage = await latestRelayMessage(label);
    expect(relayMessage).not.toBeNull();
    expect(relayMessage?.isCredit).toBe(false);
    expect(relayMessage?.bankCreditId).toBeNull();
  });

  it("matches a credit-shaped message with a real reference against a live deposit and completes it", async () => {
    const label = `${DEVICE_LABEL}-matched`;
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 14_000,
      correlationId: randomUUID(),
    });
    const rupees = (deposit.amountInr / 100).toFixed(2);
    const refNo = randomUUID().replace(/-/g, "").slice(0, 12);

    const res = await POST(
      relayRequest({
        body: {
          sender: "SBI",
          body: `Dear Customer, Rs.${rupees} credited to A/c XX1234. Ref No: ${refNo}`,
          deviceLabel: label,
        },
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, matched: true });

    const updatedDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updatedDeposit.status).toBe("COMPLETED");

    const relayMessage = await latestRelayMessage(label);
    expect(relayMessage?.bankCreditId).not.toBeNull();
    if (relayMessage?.bankCreditId) createdBankCreditIds.push(relayMessage.bankCreditId);

    const credit = await prisma.bankCredit.findUniqueOrThrow({
      where: { id: relayMessage!.bankCreditId! },
    });
    expect(credit.consumed).toBe(true);
    expect(credit.vpa).toBe(DEMO_VPA);
  });

  it("recovers a credit stranded by a crashed prior attempt instead of orphaning it forever (Fix 1+2)", async () => {
    // Manufactures exactly the DB state a crash between "BankCredit created"
    // and "linked + matched" would leave behind: an unconsumed BankCredit
    // already sitting at the deterministic synthetic UTR this UTR-less
    // message would hash to, with no RelayMessage pointing at it yet. The
    // old code's duplicate branch (treat any P2002 as "harmless, ignore")
    // would leave this credit stranded forever. The fixed code must instead
    // recognise it as unconsumed and recover it: link + match.
    const label = `${DEVICE_LABEL}-recovery`;
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 16_000,
      correlationId: randomUUID(),
    });
    const rupees = (deposit.amountInr / 100).toFixed(2);
    const sender = "SBI";
    const bodyText = `Dear Customer, Rs.${rupees} credited to A/c XX1234 on today.`;
    const receivedAtIso = new Date().toISOString();

    const utr = expectedSyntheticUtr(sender, bodyText, new Date(receivedAtIso));
    const stranded = await prisma.bankCredit.create({
      data: {
        vpa: DEMO_VPA,
        amountInr: deposit.amountInr,
        utr,
        receivedAt: new Date(receivedAtIso),
        raw: bodyText,
        consumed: false,
      },
    });
    createdBankCreditIds.push(stranded.id);

    const res = await POST(
      relayRequest({
        body: { sender, body: bodyText, receivedAt: receivedAtIso, deviceLabel: label },
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, matched: true });

    const updatedDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updatedDeposit.status).toBe("COMPLETED");

    const updatedCredit = await prisma.bankCredit.findUniqueOrThrow({ where: { id: stranded.id } });
    expect(updatedCredit.consumed).toBe(true);
    expect(updatedDeposit.matchedCreditId).toBe(stranded.id);

    // Exactly one BankCredit row for this UTR — the retry reused the
    // stranded row rather than being defeated by it or duplicating it.
    expect(await prisma.bankCredit.count({ where: { utr } })).toBe(1);

    // A genuine retry of the exact same payload after it's fully processed
    // is a harmless no-op, not a second credit and not a second completion.
    const retryLabel = `${DEVICE_LABEL}-recovery-retry`;
    const retryRes = await POST(
      relayRequest({
        body: { sender, body: bodyText, receivedAt: receivedAtIso, deviceLabel: retryLabel },
      }),
    );
    expect(retryRes.status).toBe(202);
    expect(await retryRes.json()).toEqual({ accepted: true, matched: false });
    expect(await prisma.bankCredit.count({ where: { utr } })).toBe(1);

    const finalDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(finalDeposit.status).toBe("COMPLETED");
  });
});
