import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "t" }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-session", () => ({ ADMIN_SESSION_COOKIE: "c", readAdminSession: async () => true }));

import { isKycRequired, prisma } from "@asm/db";
import { setKycRequiredAction } from "./actions";

afterAll(async () => {
  await prisma.platformSettings.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { action: "platform.kyc_requirement_changed", actorId: "admin-panel" } });
  await prisma.$disconnect();
});

function form(value: string): FormData {
  const f = new FormData();
  f.set("kycRequired", value);
  return f;
}

describe("KYC requirement action", () => {
  it("switches KYC off and on and ignores junk", async () => {
    await setKycRequiredAction(form("false"));
    expect(await isKycRequired()).toBe(false);
    await setKycRequiredAction(form("maybe"));
    expect(await isKycRequired()).toBe(false);
    await setKycRequiredAction(form("true"));
    expect(await isKycRequired()).toBe(true);
  });
});
