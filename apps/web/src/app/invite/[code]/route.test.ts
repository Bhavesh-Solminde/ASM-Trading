import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createAffiliateLink, ensureDefaultAffiliateLink, ensureReferralCode, prisma, recordAffiliateLinkClick, resolveTrackedAffiliateLink } from "@asm/db";
import { redis } from "@/lib/redis";
import { GET } from "./route";
import { GET as trackedGET } from "../../r/[code]/route";
import { GET as downloadGET } from "../../download/route";

vi.mock("@asm/db", async (original) => {
  const db = await original<typeof import("@asm/db")>();
  return {
    ...db,
    ensureDefaultAffiliateLink: vi.fn(db.ensureDefaultAffiliateLink),
    resolveTrackedAffiliateLink: vi.fn(db.resolveTrackedAffiliateLink),
    recordAffiliateLinkClick: vi.fn(db.recordAffiliateLinkClick),
  };
});

const RUN = randomUUID();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

function open(code: string, cookie?: string) {
  const req = new NextRequest(`http://localhost/invite/${code}`, {
    headers: { "x-forwarded-for": randomUUID(), ...(cookie && { cookie }) },
  });
  return GET(req, { params: Promise.resolve({ code }) });
}

describe("GET /invite/[code]", () => {
  it("sets asm_ref to the normalised code and 303s to /register", async () => {
    const u = await prisma.user.create({ data: { email: `invite-${RUN}@test.local`, passwordHash: "x" } });
    const code = await ensureReferralCode(u.id);
    const res = await open(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`, "asm_ref=OLDCODE2");
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/register");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`asm_ref=${code}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=34560000/);
    expect(cookie).toMatch(/Path=\//);
  });

  it("leaves an existing cookie untouched for an invalid code", async () => {
    for (const code of ["ZZZZZZZZ", "not a code", "%2F%2Fevil.example"]) {
      const res = await open(code, "asm_ref=ABCDEFGH");
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/register");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("keeps a resolved invitation cookie when the default link lookup throws", async () => {
    const user = await prisma.user.create({ data: { email: `link-error-${RUN}@test.local`, passwordHash: "x", role: "AFFILIATE" } });
    const code = await ensureReferralCode(user.id);
    vi.mocked(ensureDefaultAffiliateLink).mockRejectedValueOnce(new Error("test default-link outage"));
    const response = await open(code);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/register");
    expect(response.cookies.get("asm_ref")?.value).toBe(code);
    expect(response.cookies.get("asm_ref_link")?.maxAge).toBe(0);
  });

  it("redirects a tracked link on lookup or click-recording failure", async () => {
    const code = "000000000000";
    const visit = () => trackedGET(new NextRequest(`http://aff.localhost:3271/r/${code}`, {
      headers: { "x-forwarded-for": randomUUID(), cookie: "asm_ref=ABCDEFGH" },
    }), { params: Promise.resolve({ code }) });
    vi.mocked(resolveTrackedAffiliateLink).mockRejectedValueOnce(new Error("test tracked-link outage"));
    const fallback = await visit();
    expect(fallback.status).toBe(303);
    expect(new URL(fallback.headers.get("location")!).pathname).toBe("/register");
    expect(fallback.headers.get("set-cookie")).toBeNull();

    const id = randomUUID();
    vi.mocked(resolveTrackedAffiliateLink).mockResolvedValueOnce({ id, kind: "APP", referralCode: "ABCDEFGH" });
    vi.mocked(recordAffiliateLinkClick).mockRejectedValueOnce(new Error("test click-recording outage"));
    const destination = await visit();
    expect(destination.status).toBe(303);
    expect(new URL(destination.headers.get("location")!).pathname).toBe("/download");
    expect(destination.cookies.get("asm_ref")?.value).toBe("ABCDEFGH");
    expect(destination.cookies.get("asm_ref_link")?.value).toBe(id);
  });

  it("counts the default click once per IP, preserves attribution, and uses the IST day", async () => {
    const affiliate = await prisma.user.create({ data: { email: `affiliate-${RUN}@test.local`, passwordHash: "x", role: "AFFILIATE" } });
    const code = await ensureReferralCode(affiliate.id);
    const ip = randomUUID();
    const request = new NextRequest(`http://aff.localhost:3271/invite/${code}`, { headers: { "x-forwarded-for": ip } });
    const context = { params: Promise.resolve({ code }) };
    const [initial, repeat] = await Promise.all([GET(request, context), GET(request, context)]);
    const link = await prisma.affiliateLink.findFirstOrThrow({ where: { affiliateId: affiliate.id, isDefault: true } });
    expect(initial.cookies.get("asm_ref_link")?.value).toBe(link.id);
    expect(repeat.cookies.get("asm_ref_link")?.value).toBe(link.id);
    const [day] = await prisma.affiliateLinkDay.findMany({ where: { linkId: link.id } });
    expect(day?.clicks).toBe(1);
    expect(day?.day.toISOString().slice(0, 10)).toBe(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  });

  it("sets both cookies for tracked destinations and leaves them alone for invalid codes", async () => {
    const affiliate = await prisma.user.create({ data: { email: `tracked-${RUN}@test.local`, passwordHash: "x", role: "AFFILIATE" } });
    const ref = await ensureReferralCode(affiliate.id);
    for (const [kind, path] of [["HOME", "/"], ["REGISTER", "/register"], ["APP", "/download"]] as const) {
      const link = await createAffiliateLink(affiliate.id, { kind });
      const request = new NextRequest(`http://aff.localhost:3271${link.url}`, { headers: { "x-forwarded-for": randomUUID() } });
      const response = await trackedGET(request, { params: Promise.resolve({ code: link.code }) });
      expect(response.status).toBe(303);
      expect(new URL(response.headers.get("location")!).pathname).toBe(path);
      expect(response.cookies.get("asm_ref")?.value).toBe(ref);
      expect(response.cookies.get("asm_ref_link")?.value).toBe(link.id);
      expect((await prisma.affiliateLinkDay.findFirst({ where: { linkId: link.id } }))?.clicks).toBe(1);
    }
    expect(downloadGET).toThrow("NEXT_REDIRECT");
    const invalid = await trackedGET(new NextRequest("http://aff.localhost:3271/r/invalid", { headers: { "x-forwarded-for": randomUUID() } }), {
      params: Promise.resolve({ code: "invalid" }),
    });
    expect(invalid.status).toBe(303);
    expect(new URL(invalid.headers.get("location")!).pathname).toBe("/register");
    expect(invalid.headers.get("set-cookie")).toBeNull();
  });
});
