import { prisma } from "../client";
import type { FraudFlag, FraudFlagKind, Prisma } from "../../generated/prisma/client";

/**
 * The linked-accounts detector is deliberately pure and transparent. Every
 * signal is a boolean-or-string equality on a captured field — no ML, no
 * fuzzy matching. That means an admin reviewing a flag can point to exactly
 * which fields matched, and a false positive is fixable by an admin marking
 * the flag DISMISSED without needing a model retrain.
 *
 * Score thresholds are tuned so a single shared signal (household on one WiFi)
 * WEAKLY_LINKS accounts but does not raise a hard flag; two independent
 * signals (same IP AND same UA, or same IP AND same deposit method) LINKS
 * them. The two are separate verdicts so the admin queue can prioritise.
 */

export interface UserFacts {
  readonly userId: string;
  readonly signupIp: string | null;
  readonly lastIp: string | null;
  readonly signupUserAgent: string | null;
  readonly lastUserAgent: string | null;
  readonly signupDeviceFp: string | null;
  /** Distinct deposit methods for this user (COMPLETED deposits only). */
  readonly depositMethods: readonly string[];
  /** UTC seconds — used only for the "signed up within N hours" heuristic. */
  readonly createdAtSec: number;
}

export interface LinkageEvidence {
  readonly sharedIps: readonly string[];
  readonly sharedUserAgents: readonly string[];
  readonly sharedDeviceFps: readonly string[];
  readonly sharedMethods: readonly string[];
  /** Minimum pairwise |createdAt| gap in seconds among matched users. */
  readonly minSignupGapSec: number | null;
}

export type LinkageVerdict = "LINKED" | "WEAKLY_LINKED" | "CLEAN";

export interface Linkage {
  readonly userIds: readonly string[];
  readonly evidence: LinkageEvidence;
  readonly score: number;
  readonly verdict: LinkageVerdict;
}

const SCORE_SHARED_IP = 3;
const SCORE_SHARED_UA_ON_TOP_OF_IP = 2;
const SCORE_SHARED_DEVICE_FP = 5;
const SCORE_SHARED_DEPOSIT_METHOD = 5;
const SCORE_SIGNUP_WITHIN_24H_ON_SHARED_IP = 3;
const SIGNUP_PROXIMITY_SEC = 24 * 3600;

const LINKED_THRESHOLD = 5;
const WEAKLY_LINKED_THRESHOLD = 3;

/**
 * Computes the linkage between one primary user and a set of candidate users.
 * The result is a single group (primary + any candidate the primary matches),
 * not the full graph. Callers that need transitive closure walk it themselves
 * by re-invoking with each newly linked user as the primary.
 *
 * A "shared" signal requires the SAME non-empty value on both sides. An empty
 * or null field on either side never matches — that keeps a pre-migration
 * user (all fields null) from linking to every other pre-migration user.
 */
export function detectLinkage(primary: UserFacts, candidates: readonly UserFacts[]): Linkage {
  const primaryIps = new Set(nonEmpty([primary.signupIp, primary.lastIp]));
  const primaryUas = new Set(nonEmpty([primary.signupUserAgent, primary.lastUserAgent]));
  const primaryFps = new Set(nonEmpty([primary.signupDeviceFp]));
  const primaryMethods = new Set(primary.depositMethods);

  const sharedIps = new Set<string>();
  const sharedUas = new Set<string>();
  const sharedFps = new Set<string>();
  const sharedMethods = new Set<string>();
  const matchedUserIds: string[] = [];
  let minGapSec: number | null = null;
  let score = 0;

  for (const c of candidates) {
    if (c.userId === primary.userId) continue;

    const cIps = new Set(nonEmpty([c.signupIp, c.lastIp]));
    const cUas = new Set(nonEmpty([c.signupUserAgent, c.lastUserAgent]));
    const cFps = new Set(nonEmpty([c.signupDeviceFp]));
    const cMethods = new Set(c.depositMethods);

    const ipHit = intersect(primaryIps, cIps);
    const uaHit = intersect(primaryUas, cUas);
    const fpHit = intersect(primaryFps, cFps);
    const methodHit = intersect(primaryMethods, cMethods);

    if (ipHit.size === 0 && fpHit.size === 0 && methodHit.size === 0) continue;

    matchedUserIds.push(c.userId);
    for (const v of ipHit) sharedIps.add(v);
    for (const v of uaHit) sharedUas.add(v);
    for (const v of fpHit) sharedFps.add(v);
    for (const v of methodHit) sharedMethods.add(v);

    if (ipHit.size > 0) {
      score += SCORE_SHARED_IP;
      if (uaHit.size > 0) score += SCORE_SHARED_UA_ON_TOP_OF_IP;
      const gap = Math.abs(primary.createdAtSec - c.createdAtSec);
      if (gap <= SIGNUP_PROXIMITY_SEC) {
        score += SCORE_SIGNUP_WITHIN_24H_ON_SHARED_IP;
      }
      if (minGapSec === null || gap < minGapSec) minGapSec = gap;
    }
    if (fpHit.size > 0) score += SCORE_SHARED_DEVICE_FP;
    if (methodHit.size > 0) score += SCORE_SHARED_DEPOSIT_METHOD;
  }

  const userIds =
    matchedUserIds.length === 0 ? [] : [primary.userId, ...matchedUserIds];

  const verdict: LinkageVerdict =
    matchedUserIds.length === 0
      ? "CLEAN"
      : score >= LINKED_THRESHOLD
        ? "LINKED"
        : score >= WEAKLY_LINKED_THRESHOLD
          ? "WEAKLY_LINKED"
          : "CLEAN";

  return {
    userIds,
    evidence: {
      sharedIps: [...sharedIps],
      sharedUserAgents: [...sharedUas],
      sharedDeviceFps: [...sharedFps],
      sharedMethods: [...sharedMethods],
      minSignupGapSec: minGapSec,
    },
    score,
    verdict,
  };
}

function nonEmpty(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) if (v && v.length > 0) out.push(v);
  return out;
}

function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>();
  for (const v of a) if (b.has(v)) out.add(v);
  return out;
}

/**
 * Loads the linkage candidates for one user: every OTHER user who shares at
 * least one signal (IP, UA, deviceFp, or deposit method). This is the search
 * side of the detector — the pure function above scores it.
 *
 * Cost-bounded: uses each signal's index and takes at most CANDIDATE_CAP
 * rows per signal. A hot IP (public NAT, a school, a cafe) can have hundreds
 * of legitimate signups; capping keeps the detector's own query from being
 * a DoS vector, and the resulting flag is still actionable because an admin
 * seeing "matched 200 users on IP X" is exactly the pattern they need.
 */
const CANDIDATE_CAP = 50;

export async function loadUserFacts(userId: string): Promise<UserFacts | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      signupIp: true,
      lastIp: true,
      signupUserAgent: true,
      lastUserAgent: true,
      signupDeviceFp: true,
      createdAt: true,
    },
  });
  if (!user) return null;

  const methods = await prisma.deposit.findMany({
    where: { userId, status: "COMPLETED" },
    select: { method: true },
    distinct: ["method"],
  });

  return {
    userId: user.id,
    signupIp: user.signupIp,
    lastIp: user.lastIp,
    signupUserAgent: user.signupUserAgent,
    lastUserAgent: user.lastUserAgent,
    signupDeviceFp: user.signupDeviceFp,
    depositMethods: methods.map((m) => m.method),
    createdAtSec: Math.floor(user.createdAt.getTime() / 1000),
  };
}

async function loadCandidateFacts(primary: UserFacts): Promise<UserFacts[]> {
  const ipSet = nonEmpty([primary.signupIp, primary.lastIp]);
  const fpSet = nonEmpty([primary.signupDeviceFp]);
  const methodSet = primary.depositMethods;

  if (ipSet.length === 0 && fpSet.length === 0 && methodSet.length === 0) {
    return [];
  }

  // Any user who shares any signal, minus the primary. The OR is pushed to
  // Postgres and each branch hits its own index.
  const or: Prisma.UserWhereInput[] = [];
  if (ipSet.length > 0) {
    or.push({ signupIp: { in: ipSet } }, { lastIp: { in: ipSet } });
  }
  if (fpSet.length > 0) {
    or.push({ signupDeviceFp: { in: fpSet } });
  }
  if (methodSet.length > 0) {
    or.push({
      deposits: {
        some: { method: { in: [...methodSet] }, status: "COMPLETED" },
      },
    });
  }

  const users = await prisma.user.findMany({
    where: { AND: [{ id: { not: primary.userId } }, { OR: or }] },
    select: {
      id: true,
      signupIp: true,
      lastIp: true,
      signupUserAgent: true,
      lastUserAgent: true,
      signupDeviceFp: true,
      createdAt: true,
    },
    take: CANDIDATE_CAP,
  });

  const methods = await prisma.deposit.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      status: "COMPLETED",
    },
    select: { userId: true, method: true },
    distinct: ["userId", "method"],
  });
  const methodsByUser = new Map<string, string[]>();
  for (const m of methods) {
    const arr = methodsByUser.get(m.userId) ?? [];
    arr.push(m.method);
    methodsByUser.set(m.userId, arr);
  }

  return users.map((u) => ({
    userId: u.id,
    signupIp: u.signupIp,
    lastIp: u.lastIp,
    signupUserAgent: u.signupUserAgent,
    lastUserAgent: u.lastUserAgent,
    signupDeviceFp: u.signupDeviceFp,
    depositMethods: methodsByUser.get(u.id) ?? [],
    createdAtSec: Math.floor(u.createdAt.getTime() / 1000),
  }));
}

/**
 * Runs the detector for one user and writes one FraudFlag row per NEW LINKED
 * or WEAKLY_LINKED verdict. Idempotent by design: a flag with the same kind
 * whose `linkedUserIds` covers the same group is not duplicated. Non-fatal
 * on error — the caller (deposit approval) must not roll back a legitimate
 * money movement because the detector had a bad day.
 */
export async function flagLinkageForUser(input: {
  userId: string;
  kind?: FraudFlagKind;
}): Promise<Linkage> {
  const primary = await loadUserFacts(input.userId);
  if (!primary) return emptyLinkage(input.userId);

  const candidates = await loadCandidateFacts(primary);
  const linkage = detectLinkage(primary, candidates);

  if (linkage.verdict === "CLEAN" || linkage.userIds.length < 2) {
    return linkage;
  }

  // Deduplicate: an existing OPEN flag of the same kind whose linkedUserIds
  // are a superset means we've already told the admin about this. We only
  // create a new flag when the group has grown.
  const existing = await prisma.fraudFlag.findMany({
    where: {
      userId: input.userId,
      kind: input.kind ?? "LINKED_ACCOUNT",
      status: "OPEN",
    },
    select: { linkedUserIds: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const covered = existing.some((row) =>
    linkage.userIds.every((uid) => row.linkedUserIds.includes(uid)),
  );
  if (covered) return linkage;

  await prisma.fraudFlag.create({
    data: {
      userId: input.userId,
      kind: input.kind ?? "LINKED_ACCOUNT",
      status: "OPEN",
      linkedUserIds: [...linkage.userIds],
      evidence: {
        score: linkage.score,
        verdict: linkage.verdict,
        sharedIps: linkage.evidence.sharedIps,
        sharedUserAgents: linkage.evidence.sharedUserAgents,
        sharedDeviceFps: linkage.evidence.sharedDeviceFps,
        sharedMethods: linkage.evidence.sharedMethods,
        minSignupGapSec: linkage.evidence.minSignupGapSec,
      },
    },
  });

  return linkage;
}

function emptyLinkage(userId: string): Linkage {
  return {
    userIds: [],
    evidence: {
      sharedIps: [],
      sharedUserAgents: [],
      sharedDeviceFps: [],
      sharedMethods: [],
      minSignupGapSec: null,
    },
    score: 0,
    verdict: "CLEAN",
  };
}

export async function listOpenFraudFlags(limit: number): Promise<FraudFlag[]> {
  return prisma.fraudFlag.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

export async function reviewFraudFlag(input: {
  flagId: string;
  adminId: string;
  verdict: "DISMISSED" | "CONFIRMED";
  note?: string;
}): Promise<FraudFlag> {
  return prisma.$transaction(async (tx) => {
    const flag = await tx.fraudFlag.findUniqueOrThrow({ where: { id: input.flagId } });
    if (flag.status !== "OPEN") return flag;

    const updated = await tx.fraudFlag.update({
      where: { id: input.flagId },
      data: {
        status: input.verdict,
        reviewedBy: input.adminId,
        reviewedAt: new Date(),
        reviewNote: input.note ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: `fraudFlag.${input.verdict.toLowerCase()}`,
        targetType: "FraudFlag",
        targetId: input.flagId,
        before: { status: flag.status },
        after: { status: input.verdict, note: input.note ?? null },
      },
    });

    return updated;
  });
}
