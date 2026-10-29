import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendWithdrawalPaidEmail: vi.fn<(input: Record<string, unknown>) => Promise<{ ok: true; id: string }>>(async () => ({ ok: true, id: "em" })),
  sendWithdrawalRejectedEmail: vi.fn<(input: Record<string, unknown>) => Promise<{ ok: true; id: string }>>(async () => ({ ok: true, id: "em" })),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));

import { prisma } from "@asm/db";
import { emailWithdrawalPaid, emailWithdrawalRejected } from "./withdrawal-mail";

const RUN = randomUUID();
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `wmail-${RUN}@test.local`, passwordHash: "x", firstName: "Asha", lastName: "Rao" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mail.sendWithdrawalPaidEmail.mockClear();
  mail.sendWithdrawalRejectedEmail.mockClear();
});

function makeWithdrawal(status: "PAID" | "REJECTED" | "APPROVED", reason: string | null = null) {
  return prisma.withdrawal.create({
    data: { userId, amount: 2_500_00, currency: "INR", method: "UPI", upiId: "asha@okhdfc", status, reason },
  });
}

describe("withdrawal emails", () => {
  it("sends the rendered certificate image with the payout destination", async () => {
    const w = await makeWithdrawal("PAID");
    await emailWithdrawalPaid(w.id);
    expect(mail.sendWithdrawalPaidEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: `wmail-${RUN}@test.local`,
        withdrawalId: w.id,
        payToLabel: "UPI · asha@okhdfc",
        certificate: expect.objectContaining({
          name: "Asha Rao",
          amountLabel: "₹2,500.00",
          dateLabel: expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/),
          refId: w.id.slice(0, 8).toUpperCase(),
        }),
        // base64 of a JPEG starts with the FF D8 FF magic bytes
        certificateJpegBase64: expect.stringMatching(/^\/9j\//),
      }),
    );
  });

  it("does not send a certificate for a withdrawal that is not PAID", async () => {
    const w = await makeWithdrawal("APPROVED");
    await emailWithdrawalPaid(w.id);
    expect(mail.sendWithdrawalPaidEmail).not.toHaveBeenCalled();
  });

  it("sends the rejection with the admin's preset reason", async () => {
    const w = await makeWithdrawal("REJECTED", "The UPI ID couldn't receive the payment");
    await emailWithdrawalRejected(w.id);
    expect(mail.sendWithdrawalRejectedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ withdrawalId: w.id, amountLabel: "₹2,500.00", reason: "The UPI ID couldn't receive the payment" }),
    );
  });

  it("never throws, even for an unknown id", async () => {
    await expect(emailWithdrawalPaid(randomUUID())).resolves.toBeUndefined();
    await expect(emailWithdrawalRejected(randomUUID())).resolves.toBeUndefined();
  });
});
