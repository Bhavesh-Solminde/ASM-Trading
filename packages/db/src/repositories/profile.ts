import { prisma } from "../client";
import type { KycDocumentKind, Prisma } from "../../generated/prisma/client";

export interface ProfileView {
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  aadhaar: string | null;
  pan: string | null;
  address: string | null;
  country: string | null;
  kycStatus: string;
  /** Why an admin rejected the last submission (null unless REJECTED). */
  kycReviewNote: string | null;
  /** Which KYC documents are on file (never the files themselves). */
  kycDocuments: KycDocumentKind[];
  twoFaForLogin: boolean;
  twoFaForWithdrawal: boolean;
}

/** Every document a KYC submission needs, in the order the flow asks for them. */
export const KYC_DOCUMENT_KINDS: readonly KycDocumentKind[] = [
  "AADHAAR_FRONT",
  "AADHAAR_BACK",
  "PAN",
  "SELFIE",
];

const IDENTITY_FIELDS = ["firstName", "lastName", "dateOfBirth", "aadhaar", "pan", "address", "country"] as const;
type IdentityField = (typeof IDENTITY_FIELDS)[number];

/** Identity data is frozen while it is in review or once it is verified. */
function kycLocked(kycStatus: string): boolean {
  return kycStatus === "PENDING" || kycStatus === "VERIFIED";
}

export class KycLocked extends Error {
  constructor() {
    super("Your identity details are locked while they are in review or verified.");
    this.name = "KycLocked";
  }
}

export async function loadProfile(actorId: string): Promise<ProfileView> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
    select: {
      email: true,
      emailVerified: true,
      nickname: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      aadhaar: true,
      pan: true,
      address: true,
      country: true,
      kycStatus: true,
      kycReviewNote: true,
      twoFaForLogin: true,
      twoFaForWithdrawal: true,
      kycDocuments: { select: { kind: true } },
    },
  });

  return {
    ...user,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
    kycDocuments: KYC_DOCUMENT_KINDS.filter((k) => user.kycDocuments.some((d) => d.kind === k)),
  };
}

/**
 * Writes only the whitelisted profile fields.
 *
 * Fields are picked explicitly rather than spread, so even if the schema
 * changes, `role`, `kycStatus` and `cumulativeDeposits` cannot be reached
 * through this path. Saving never submits KYC — that is submitKyc's job, once
 * the documents are uploaded too. Identity fields are refused (KycLocked) while
 * KYC is PENDING or VERIFIED, so a verified identity can't be swapped out;
 * the nickname stays editable.
 */
export async function updateProfile(
  actorId: string,
  input: {
    nickname?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    dateOfBirth?: string | undefined;
    aadhaar?: string | undefined;
    pan?: string | undefined;
    address?: string | undefined;
    country?: string | undefined;
  },
): Promise<void> {
  // Assign only the fields actually supplied. Building the object conditionally
  // (rather than passing `undefined` values) satisfies exactOptionalPropertyTypes
  // and leaves untouched fields as they were.
  const data: Prisma.UserUpdateInput = {};
  if (input.nickname !== undefined) data.nickname = input.nickname;
  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;
  if (input.dateOfBirth !== undefined) data.dateOfBirth = new Date(input.dateOfBirth);
  if (input.aadhaar !== undefined) data.aadhaar = input.aadhaar;
  if (input.pan !== undefined) data.pan = input.pan;
  if (input.address !== undefined) data.address = input.address;
  if (input.country !== undefined) data.country = input.country;

  const touchesIdentity = IDENTITY_FIELDS.some((f) => input[f] !== undefined);
  if (touchesIdentity) {
    const { kycStatus } = await prisma.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { kycStatus: true },
    });
    if (kycLocked(kycStatus)) throw new KycLocked();
  }

  await prisma.user.update({ where: { id: actorId }, data });
}

/**
 * Stores an uploaded KYC document image, replacing any earlier one of the
 * same kind. Refused while KYC is PENDING or VERIFIED.
 */
export async function saveKycDocument(
  actorId: string,
  kind: KycDocumentKind,
  image: { contentType: string; data: Uint8Array<ArrayBuffer> },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { kycStatus: true },
    });
    if (kycLocked(user.kycStatus)) throw new KycLocked();

    await tx.kycDocument.upsert({
      where: { userId_kind: { userId: actorId, kind } },
      create: { userId: actorId, kind, contentType: image.contentType, data: image.data },
      update: { contentType: image.contentType, data: image.data },
    });
  });
}

export type KycSubmitResult =
  | { ok: true }
  | { ok: false; missingFields: IdentityField[]; missingDocuments: KycDocumentKind[] }
  | { ok: false; locked: true };

/**
 * Submits the account for review: every identity field and every document
 * must be on file. NOT_STARTED (or a REJECTED resubmission) moves to PENDING,
 * where an admin sets VERIFIED or REJECTED from the Users panel. PENDING and
 * VERIFIED are never touched, so a user can't re-queue or un-verify themselves.
 */
export async function submitKyc(actorId: string): Promise<KycSubmitResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
    select: {
      kycStatus: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      aadhaar: true,
      pan: true,
      address: true,
      country: true,
      kycDocuments: { select: { kind: true } },
    },
  });
  if (kycLocked(user.kycStatus)) return { ok: false, locked: true };

  const missingFields = IDENTITY_FIELDS.filter((f) => user[f] === null || user[f] === "");
  const missingDocuments = KYC_DOCUMENT_KINDS.filter((k) => !user.kycDocuments.some((d) => d.kind === k));
  if (missingFields.length > 0 || missingDocuments.length > 0) {
    return { ok: false, missingFields, missingDocuments };
  }

  // Conditional on the status read above, so a concurrent admin decision wins.
  const moved = await prisma.user.updateMany({
    where: { id: actorId, kycStatus: { in: ["NOT_STARTED", "REJECTED"] } },
    data: { kycStatus: "PENDING", kycSubmittedAt: new Date(), kycReviewNote: null },
  });
  return moved.count === 1 ? { ok: true } : { ok: false, locked: true };
}

export class KycNotPending extends Error {
  constructor() {
    super("This KYC submission is no longer waiting for review.");
    this.name = "KycNotPending";
  }
}

/**
 * Admin decision on a PENDING submission: VERIFIED unlocks withdrawals,
 * REJECTED sends the user back to fix and resubmit, with `note` shown to them.
 * Conditional on PENDING so two admins can't both decide (the loser gets
 * KycNotPending), and audited like every other admin action.
 */
export async function reviewKyc(input: {
  userId: string;
  decision: "VERIFIED" | "REJECTED";
  adminId: string;
  note?: string | null;
}): Promise<void> {
  const note = input.decision === "REJECTED" ? (input.note?.trim() || null) : null;
  await prisma.$transaction(async (tx) => {
    const moved = await tx.user.updateMany({
      where: { id: input.userId, kycStatus: "PENDING" },
      data: { kycStatus: input.decision, kycReviewNote: note },
    });
    if (moved.count !== 1) throw new KycNotPending();
    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: input.decision === "VERIFIED" ? "kyc.approved" : "kyc.rejected",
        targetType: "User",
        targetId: input.userId,
        before: { kycStatus: "PENDING" },
        after: { kycStatus: input.decision, ...(note ? { note } : {}) },
      },
    });
  });
}

/** The user's KYC documents for the admin review page — metadata only, no image bytes. */
export async function listKycDocuments(
  userId: string,
): Promise<{ id: string; kind: KycDocumentKind; updatedAt: Date }[]> {
  const docs = await prisma.kycDocument.findMany({
    where: { userId },
    select: { id: true, kind: true, updatedAt: true },
  });
  return KYC_DOCUMENT_KINDS.flatMap((k) => docs.filter((d) => d.kind === k));
}

/** One document's image, for the admin-only image route. Never call from a user-facing path. */
export async function loadKycDocumentImage(
  documentId: string,
): Promise<{ contentType: string; data: Uint8Array } | null> {
  return prisma.kycDocument.findUnique({
    where: { id: documentId },
    select: { contentType: true, data: true },
  });
}

export async function setTwoFactorPreferences(
  actorId: string,
  prefs: { forLogin: boolean; forWithdrawal: boolean },
): Promise<void> {
  await prisma.user.update({
    where: { id: actorId },
    data: {
      twoFaForLogin: prefs.forLogin,
      twoFaForWithdrawal: prefs.forWithdrawal,
      twoFaEnabled: prefs.forLogin || prefs.forWithdrawal,
    },
  });
}
