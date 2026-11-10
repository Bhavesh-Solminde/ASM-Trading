import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { SESSION_COOKIE, createSession } from "./session";
import { getSession, noStoreJson, rateLimited, sessionTokenFrom, unauthenticated } from "./request-session";

let userId = "";
let otherUserId = "";
let appToken = "";
let webToken = "";

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { email: `rs-a-${randomUUID()}@test.local`, passwordHash: "x" } }),
    prisma.user.create({ data: { email: `rs-b-${randomUUID()}@test.local`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  appToken = await createSession(userId, { client: "APP" });
  webToken = await createSession(otherUserId, {});
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.$disconnect();
});

function req(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/anything", { headers });
}

describe("sessionTokenFrom", () => {
  it("prefers the bearer token over the cookie", () => {
    expect(sessionTokenFrom(req({ authorization: `Bearer ${appToken}`, cookie: `${SESSION_COOKIE}=${webToken}` }))).toBe(appToken);
  });
  it("does not fall back to the cookie when the bearer header is malformed", () => {
    expect(sessionTokenFrom(req({ authorization: "Bearer !!", cookie: `${SESSION_COOKIE}=${webToken}` }))).toBeUndefined();
  });
  it("uses the cookie when there is no authorization header", () => {
    expect(sessionTokenFrom(req({ cookie: `${SESSION_COOKIE}=${webToken}` }))).toBe(webToken);
  });
});

describe("getSession", () => {
  it("resolves a bearer token to its user", async () => {
    expect((await getSession(req({ authorization: `Bearer ${appToken}` })))?.userId).toBe(userId);
  });
  it("still resolves a cookie session", async () => {
    expect((await getSession(req({ cookie: `${SESSION_COOKIE}=${webToken}` })))?.userId).toBe(otherUserId);
  });
  it("returns null for an unknown bearer token", async () => {
    expect(await getSession(req({ authorization: `Bearer ${"a".repeat(43)}` }))).toBeNull();
  });
});

describe("responses", () => {
  it("unauthenticated carries the stable code", async () => {
    const res = unauthenticated();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in.", code: "unauthenticated" });
  });
  it("rateLimited carries the stable code and an optional message", async () => {
    const res = rateLimited("Slow down.");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Slow down.", code: "rate_limited" });
    expect(await rateLimited().json()).toEqual({ error: "Too many requests.", code: "rate_limited" });
  });
  it("noStoreJson disables caching", () => {
    expect(noStoreJson({ ok: true }).headers.get("cache-control")).toBe("no-store");
  });
});
