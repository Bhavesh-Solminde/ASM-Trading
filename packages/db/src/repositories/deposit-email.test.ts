import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendDepositCreditedEmail } = vi.hoisted(() => ({
  sendDepositCreditedEmail: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const, id: "em_1" })),
}));
vi.mock("@asm/mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@asm/mail")>()),
  sendDepositCreditedEmail,
}));

import { prisma } from "../client";
import { formatMoney } from "../money";
import { createAccountsForUser } from "./account";
import { DepositAlreadyResolved, createDepositIntent, creditDepositToAccount } from "./deposit";

let userId = "";
let email = "";

beforeAll(async () => {
  email = `deposit-email-${randomUUID()}@test.local`;
  const user = await prisma.user.create({ data: { email, passwordHash: "x", firstName: "Asha", lastName: "Rao" } });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(() => sendDepositCreditedEmail.mockClear());

// A random rupee amount, so the live-amount unique index never collides with
// another test's open deposit.
const randomAmount = () => (500 + Math.floor(Math.random() * 40_000)) * 100;

describe("deposit-credited email", () => {
  it("emails the credited amount and the bonus once the deposit commits", async () => {
    const deposit = await createDepositIntent({ userId, method: "upi", amountInrMinor: randomAmount(), correlationId: randomUUID() });
    // The intent nudges the amount by a few paise so it's unique; credit what it reserved.
    const amount = deposit.amountInr;
    await creditDepositToAccount({ depositId: deposit.id, adminId: "test-admin", creditId: null });

    expect(sendDepositCreditedEmail).toHaveBeenCalledTimes(1);
    // First deposit: 100% bonus.
    expect(sendDepositCreditedEmail).toHaveBeenCalledWith({
      to: email,
      name: "Asha Rao",
      depositId: deposit.id,
      creditLabel: formatMoney(amount, "INR"),
      bonusLabel: formatMoney(amount, "INR"),
      totalLabel: formatMoney(amount * 2, "INR"),
    });
  });

  it("sends nothing when the deposit was already credited", async () => {
    const deposit = await createDepositIntent({ userId, method: "upi", amountInrMinor: randomAmount(), correlationId: randomUUID() });
    await creditDepositToAccount({ depositId: deposit.id, adminId: "test-admin", creditId: null });
    sendDepositCreditedEmail.mockClear();

    await expect(
      creditDepositToAccount({ depositId: deposit.id, adminId: "test-admin", creditId: null }),
    ).rejects.toBeInstanceOf(DepositAlreadyResolved);
    expect(sendDepositCreditedEmail).not.toHaveBeenCalled();
  });
});
