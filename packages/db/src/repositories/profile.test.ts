import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { loadProfile, updateProfile } from "./profile";

const IDENTITY = {
  firstName: "Asha",
  lastName: "Rao",
  dateOfBirth: "1990-01-31",
  aadhaar: "123412341234",
  address: "12 MG Road, Pune",
  country: "India",
};

let userId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `p-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
});

afterEach(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

describe("updateProfile KYC submission", () => {
  it("leaves KYC NOT_STARTED while identity fields are missing", async () => {
    await updateProfile(userId, { firstName: "Asha", country: "India" });
    expect((await loadProfile(userId)).kycStatus).toBe("NOT_STARTED");
  });

  it("moves to PENDING once every identity field is filled", async () => {
    await updateProfile(userId, IDENTITY);
    expect((await loadProfile(userId)).kycStatus).toBe("PENDING");
  });

  it("re-queues a REJECTED user as PENDING when they resubmit", async () => {
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "REJECTED" } });
    await updateProfile(userId, IDENTITY);
    expect((await loadProfile(userId)).kycStatus).toBe("PENDING");
  });

  it("never downgrades a VERIFIED user on a later save", async () => {
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "VERIFIED" } });
    await updateProfile(userId, { ...IDENTITY, nickname: "ash" });
    expect((await loadProfile(userId)).kycStatus).toBe("VERIFIED");
  });
});
