import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { isKycRequired, setKycRequired } from "./platform-settings";

const ACTOR = "test-platform-settings";

beforeEach(async () => {
  await prisma.platformSettings.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { actorId: ACTOR } });
});

afterAll(async () => {
  await prisma.platformSettings.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { actorId: ACTOR } });
  await prisma.$disconnect();
});

describe("KYC requirement switch", () => {
  it("defaults to required when no row exists", async () => {
    expect(await isKycRequired()).toBe(true);
  });

  it("turns off and back on, auditing each real change once", async () => {
    await setKycRequired(false, ACTOR);
    expect(await isKycRequired()).toBe(false);
    await setKycRequired(false, ACTOR);
    await setKycRequired(true, ACTOR);
    expect(await isKycRequired()).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { actorId: ACTOR }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => [a.action, a.before, a.after])).toEqual([
      ["platform.kyc_requirement_changed", { kycRequired: true }, { kycRequired: false }],
      ["platform.kyc_requirement_changed", { kycRequired: false }, { kycRequired: true }],
    ]);
  });
});
