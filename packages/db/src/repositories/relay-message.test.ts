import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createRelayMessage, linkRelayMessageToCredit, listRelayMessages } from "./relay-message";

const createdIds: string[] = [];
const createdCreditIds: string[] = [];

afterAll(async () => {
  await prisma.relayMessage.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.bankCredit.deleteMany({ where: { id: { in: createdCreditIds } } });
});

describe("createRelayMessage", () => {
  it("stores a message with all fields, parsed or not", async () => {
    const msg = await createRelayMessage({
      source: "sms-relay",
      deviceLabel: "Test phone",
      deviceModel: "Pixel 9",
      sender: "SBI",
      body: "Rs.500.00 credited to A/c XX1234",
      receivedAt: new Date(),
      parsedAmountInr: 50000,
      parsedUtr: "123456789012",
      isCredit: true,
    });
    createdIds.push(msg.id);
    expect(msg.source).toBe("sms-relay");
    expect(msg.parsedAmountInr).toBe(50000);
    expect(msg.bankCreditId).toBeNull();
  });

  it("stores a message that failed to parse, with null parsed fields", async () => {
    const msg = await createRelayMessage({
      source: "sms-relay",
      deviceLabel: null,
      deviceModel: null,
      sender: null,
      body: "Your OTP is 482913.",
      receivedAt: new Date(),
      parsedAmountInr: null,
      parsedUtr: null,
      isCredit: null,
    });
    createdIds.push(msg.id);
    expect(msg.parsedAmountInr).toBeNull();
    expect(msg.isCredit).toBeNull();
  });
});

describe("linkRelayMessageToCredit", () => {
  it("attaches a bankCreditId to an existing message", async () => {
    const msg = await createRelayMessage({
      source: "sms-relay",
      deviceLabel: null,
      deviceModel: null,
      sender: "SBI",
      body: "Rs.500.00 credited",
      receivedAt: new Date(),
      parsedAmountInr: 50000,
      parsedUtr: null,
      isCredit: true,
    });
    createdIds.push(msg.id);

    const credit = await prisma.bankCredit.create({
      data: {
        vpa: "relayed",
        amountInr: 50000,
        utr: `link-test-${Date.now()}`,
        receivedAt: new Date(),
        raw: "test",
      },
    });
    createdCreditIds.push(credit.id);

    await linkRelayMessageToCredit(msg.id, credit.id);

    const updated = await prisma.relayMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(updated.bankCreditId).toBe(credit.id);
  });
});

describe("listRelayMessages", () => {
  it("filters by source and deviceLabel", async () => {
    const unique = `filter-test-${Date.now()}`;
    const msg = await createRelayMessage({
      source: unique,
      deviceLabel: unique,
      deviceModel: null,
      sender: null,
      body: "test",
      receivedAt: new Date(),
      parsedAmountInr: null,
      parsedUtr: null,
      isCredit: null,
    });
    createdIds.push(msg.id);

    const found = await listRelayMessages({ source: unique, deviceLabel: unique }, 10);
    expect(found.map((m) => m.id)).toEqual([msg.id]);

    const notFound = await listRelayMessages({ source: "no-such-source" }, 10);
    expect(notFound).toEqual([]);
  });
});
