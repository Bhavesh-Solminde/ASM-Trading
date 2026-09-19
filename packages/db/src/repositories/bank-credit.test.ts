import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createBankCreditIfNew, listOrphanBankCredits } from "./bank-credit";

const createdIds: string[] = [];

afterAll(async () => {
  await prisma.bankCredit.deleteMany({ where: { id: { in: createdIds } } });
});

describe("createBankCreditIfNew", () => {
  it("creates a credit for a new UTR", async () => {
    const utr = `new-utr-${Date.now()}`;
    const credit = await createBankCreditIfNew({
      vpa: "relayed",
      amountInr: 50000,
      utr,
      receivedAt: new Date(),
      raw: "test body",
    });
    expect(credit).not.toBeNull();
    createdIds.push(credit!.id);
    expect(credit!.utr).toBe(utr);
    expect(credit!.consumed).toBe(false);
  });

  it("returns null rather than throwing on a duplicate UTR", async () => {
    const utr = `dup-utr-${Date.now()}`;
    const first = await createBankCreditIfNew({
      vpa: "relayed",
      amountInr: 50000,
      utr,
      receivedAt: new Date(),
      raw: "first",
    });
    createdIds.push(first!.id);

    const second = await createBankCreditIfNew({
      vpa: "relayed",
      amountInr: 60000,
      utr,
      receivedAt: new Date(),
      raw: "second, same UTR",
    });
    expect(second).toBeNull();
  });
});

describe("listOrphanBankCredits", () => {
  it("lists only unconsumed credits", async () => {
    const consumedUtr = `consumed-${Date.now()}`;
    const orphanUtr = `orphan-${Date.now()}`;

    const consumed = await prisma.bankCredit.create({
      data: { vpa: "relayed", amountInr: 1, utr: consumedUtr, receivedAt: new Date(), consumed: true },
    });
    createdIds.push(consumed.id);

    const orphan = await createBankCreditIfNew({
      vpa: "relayed",
      amountInr: 2,
      utr: orphanUtr,
      receivedAt: new Date(),
      raw: "orphan",
    });
    createdIds.push(orphan!.id);

    const found = await listOrphanBankCredits(200);
    const foundIds = found.map((c) => c.id);
    expect(foundIds).toContain(orphan!.id);
    expect(foundIds).not.toContain(consumed.id);
  });
});
