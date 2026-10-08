import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import {
  KYC_DOCUMENT_KINDS,
  KycLocked,
  KycNotPending,
  reviewKyc,
  listKycDocuments,
  loadKycDocumentImage,
  loadProfile,
  saveKycDocument,
  submitKyc,
  updateProfile,
} from "./profile";

const IDENTITY = {
  firstName: "Asha",
  lastName: "Rao",
  dateOfBirth: "1990-01-31",
  aadhaar: "123412341234",
  pan: "ABCDE1234F",
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
  await prisma.user.delete({ where: { id: userId } }); // cascades KycDocument
});

const JPEG = { contentType: "image/jpeg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };

async function uploadAll() {
  for (const kind of KYC_DOCUMENT_KINDS) await saveKycDocument(userId, kind, JPEG);
}

describe("updateProfile", () => {
  it("saving complete details does not submit KYC on its own", async () => {
    await updateProfile(userId, IDENTITY);
    expect((await loadProfile(userId)).kycStatus).toBe("NOT_STARTED");
  });

  it("refuses identity changes while KYC is PENDING or VERIFIED, but still saves the nickname", async () => {
    for (const status of ["PENDING", "VERIFIED"] as const) {
      await prisma.user.update({ where: { id: userId }, data: { kycStatus: status } });
      await expect(updateProfile(userId, { firstName: "Someone" })).rejects.toBeInstanceOf(KycLocked);
      await updateProfile(userId, { nickname: `nick-${status}` });
      const profile = await loadProfile(userId);
      expect(profile.nickname).toBe(`nick-${status}`);
      expect(profile.kycStatus).toBe(status);
    }
  });
});

describe("saveKycDocument", () => {
  it("replaces an earlier upload of the same kind, and serves the latest bytes", async () => {
    await saveKycDocument(userId, "PAN", JPEG);
    await saveKycDocument(userId, "PAN", { contentType: "image/png", data: new Uint8Array([1, 2, 3]) });
    expect(await prisma.kycDocument.count({ where: { userId } })).toBe(1);
    expect((await loadProfile(userId)).kycDocuments).toEqual(["PAN"]);

    const [listed] = await listKycDocuments(userId);
    expect(listed).toMatchObject({ kind: "PAN" });
    expect(listed).not.toHaveProperty("data"); // the list never carries image bytes
    const image = await loadKycDocumentImage(listed!.id);
    expect(image?.contentType).toBe("image/png");
    expect([...image!.data]).toEqual([1, 2, 3]);
  });

  it("refuses uploads once KYC is in review", async () => {
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "PENDING" } });
    await expect(saveKycDocument(userId, "SELFIE", JPEG)).rejects.toBeInstanceOf(KycLocked);
  });
});

describe("submitKyc", () => {
  it("reports what is missing and leaves the status alone", async () => {
    await updateProfile(userId, { firstName: "Asha", country: "India" });
    await saveKycDocument(userId, "AADHAAR_FRONT", JPEG);
    const result = await submitKyc(userId);
    expect(result).toMatchObject({
      ok: false,
      missingFields: ["lastName", "dateOfBirth", "aadhaar", "pan", "address"],
      missingDocuments: ["AADHAAR_BACK", "PAN", "SELFIE"],
    });
    expect((await loadProfile(userId)).kycStatus).toBe("NOT_STARTED");
  });

  it("moves to PENDING once every detail and document is on file", async () => {
    await updateProfile(userId, IDENTITY);
    await uploadAll();
    expect(await submitKyc(userId)).toEqual({ ok: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.kycStatus).toBe("PENDING");
    expect(user.kycSubmittedAt).not.toBeNull();
  });

  it("re-queues a REJECTED user as PENDING when they resubmit", async () => {
    await updateProfile(userId, IDENTITY);
    await uploadAll();
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "REJECTED" } });
    expect(await submitKyc(userId)).toEqual({ ok: true });
    expect((await loadProfile(userId)).kycStatus).toBe("PENDING");
  });

  it("never downgrades or re-queues a VERIFIED user", async () => {
    await updateProfile(userId, IDENTITY);
    await uploadAll();
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "VERIFIED" } });
    expect(await submitKyc(userId)).toEqual({ ok: false, locked: true });
    expect((await loadProfile(userId)).kycStatus).toBe("VERIFIED");
  });
});

describe("reviewKyc", () => {
  async function submitted() {
    await updateProfile(userId, IDENTITY);
    await uploadAll();
    expect(await submitKyc(userId)).toEqual({ ok: true });
  }

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { targetType: "User", targetId: userId } });
  });

  it("approves a pending submission and audits it", async () => {
    await submitted();
    await reviewKyc({ userId, decision: "VERIFIED", adminId: "admin-panel", note: "ignored on approve" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.kycStatus).toBe("VERIFIED");
    expect(user.kycReviewNote).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { targetId: userId, action: "kyc.approved" } });
    expect(audit).not.toBeNull();
  });

  it("rejects with a note the user sees, and a resubmission clears it", async () => {
    await submitted();
    await reviewKyc({ userId, decision: "REJECTED", adminId: "admin-panel", note: "  PAN photo is blurry  " });
    expect((await loadProfile(userId)).kycReviewNote).toBe("PAN photo is blurry");
    expect((await loadProfile(userId)).kycStatus).toBe("REJECTED");

    expect(await submitKyc(userId)).toEqual({ ok: true });
    const again = await loadProfile(userId);
    expect(again.kycStatus).toBe("PENDING");
    expect(again.kycReviewNote).toBeNull();
  });

  it("refuses to decide a submission that isn't pending (e.g. a second admin)", async () => {
    await submitted();
    await reviewKyc({ userId, decision: "VERIFIED", adminId: "admin-panel" });
    await expect(reviewKyc({ userId, decision: "REJECTED", adminId: "admin-panel" })).rejects.toBeInstanceOf(
      KycNotPending,
    );
    expect((await loadProfile(userId)).kycStatus).toBe("VERIFIED");
  });
});
