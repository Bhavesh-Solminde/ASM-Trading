import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { redis } from "./redis";

export const ADMIN_SESSION_COOKIE = "asm_admin_session";
const ADMIN_SESSION_TTL_SEC = 60 * 60 * 24; // 24h

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Timing-safe comparison against a single shared secret, independent of any
 * user account — this is deliberately not tied to the `role` field (see
 * design doc: a separate secret, not the existing ADMIN role).
 */
export function verifyAdminSecret(candidate: string): boolean {
  const secret = process.env["ADMIN_PANEL_SECRET"] ?? "";
  if (!secret || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createAdminSession(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await redis.set(`admin:session:${hashToken(token)}`, "1", "EX", ADMIN_SESSION_TTL_SEC);
  return token;
}

export async function readAdminSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const exists = await redis.get(`admin:session:${hashToken(token)}`);
  return exists !== null;
}

export async function destroyAdminSession(token: string): Promise<void> {
  await redis.del(`admin:session:${hashToken(token)}`);
}

export const ADMIN_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: ADMIN_SESSION_TTL_SEC,
};
