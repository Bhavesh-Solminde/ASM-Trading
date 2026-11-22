import { randomBytes } from "node:crypto";
import type { AffiliateLink } from "../../generated/prisma/client";
import { prisma } from "../client";
import type { AffiliateLinkRow } from "./affiliate-center";
import { houseDateForInstant } from "./house-day";
import { ProgramActionRefused } from "./program-errors";
import { ensureReferralCode } from "./referral";

const MAX_LINKS = 50;
const MAX_COMMENT_LENGTH = 200;

type CreateLinkInput = { kind: AffiliateLinkRow["kind"]; comment?: string };

function linkView(link: AffiliateLink): AffiliateLinkRow {
  const { id, code, kind, comment, isDefault, createdAt } = link;
  const url = isDefault ? `/invite/${code}` : `/r/${code}`;
  return { id, code, url, kind, comment, isDefault, createdAt };
}

export async function ensureDefaultAffiliateLink(affiliateId: string): Promise<AffiliateLink | null> {
  const affiliate = await prisma.user.findUnique({
    where: { id: affiliateId, role: "AFFILIATE", legacySimulated: false },
    select: { referralCode: true },
  });
  if (!affiliate) return null;
  const where = { affiliateId, isDefault: true };
  const existing = await prisma.affiliateLink.findFirst({ where });
  if (existing) return existing;
  const code = affiliate.referralCode ?? await ensureReferralCode(affiliateId);
  await prisma.affiliateLink.createMany({ data: { affiliateId, code, kind: "REGISTER", isDefault: true }, skipDuplicates: true });
  return prisma.affiliateLink.findFirstOrThrow({ where });
}

export async function listAffiliateLinks(affiliateId: string): Promise<AffiliateLinkRow[]> {
  if (!await ensureDefaultAffiliateLink(affiliateId)) throw new ProgramActionRefused("not_found");
  const links = await prisma.affiliateLink.findMany({
    where: { affiliateId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });
  return links.map(linkView);
}

export async function createAffiliateLink(affiliateId: string, input: CreateLinkInput): Promise<AffiliateLinkRow> {
  const comment = input.comment?.trim() || null;
  if (comment && comment.length > MAX_COMMENT_LENGTH) {
    throw new ProgramActionRefused("invalid_input", "Link comments can have up to 200 characters.");
  }
  if (!await ensureDefaultAffiliateLink(affiliateId)) throw new ProgramActionRefused("not_found");

  const link = await prisma.$transaction(async (tx) => {
    // All extra-link creates for this owner take the same lock before checking the limit.
    const [owner] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE id = ${affiliateId} AND role = 'AFFILIATE' AND NOT "legacySimulated"
      FOR NO KEY UPDATE`;
    if (!owner) throw new ProgramActionRefused("not_found");
    if (await tx.affiliateLink.count({ where: { affiliateId } }) >= MAX_LINKS) {
      throw new ProgramActionRefused("link_limit", "You can create up to 50 links, including your default link.");
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const [created] = await tx.affiliateLink.createManyAndReturn({
        data: { affiliateId, code: randomBytes(6).toString("hex"), kind: input.kind, comment },
        skipDuplicates: true,
      });
      if (created) return created;
    }
    throw new Error("Could not generate a unique affiliate link code");
  });
  return linkView(link);
}

export async function resolveTrackedAffiliateLink(code: string) {
  if (!/^[a-f0-9]{12}$/.test(code)) return null;
  const link = await prisma.affiliateLink.findUnique({
    where: {
      code,
      isDefault: false,
      archivedAt: null,
      affiliate: { role: "AFFILIATE", legacySimulated: false, status: { in: ["ACTIVE", "FLAGGED"] } },
    },
    select: { id: true, kind: true, affiliate: { select: { referralCode: true } } },
  });
  const referralCode = link?.affiliate.referralCode;
  return link && referralCode ? { id: link.id, kind: link.kind, referralCode } : null;
}

export async function recordAffiliateLinkClick(linkId: string, now = new Date()) {
  const day = houseDateForInstant(now);
  // A native upsert makes the first clicks of a new IST day atomic.
  await prisma.$executeRaw`
    INSERT INTO "AffiliateLinkDay" ("linkId", day, clicks) VALUES (${linkId}, ${day}::date, 1)
    ON CONFLICT ("linkId", day) DO UPDATE SET clicks = "AffiliateLinkDay".clicks + 1`;
}
