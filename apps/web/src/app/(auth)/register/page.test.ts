import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ ref: undefined as string | undefined }));
const db = vi.hoisted(() => ({
  normaliseReferralCode: (raw: string) => (/^[A-Z2-9]{8}$/.test(raw.trim().toUpperCase()) ? raw.trim().toUpperCase() : null),
  resolveInvitationCode: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "asm_ref" && jar.ref ? { value: jar.ref } : undefined) }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@asm/db", () => db);
vi.mock("@/lib/referral", () => ({ REFERRAL_COOKIE: "asm_ref", invitedFirstDepositBonusPct: async () => 110 }));
vi.mock("@/lib/google-oauth", () => ({ googleSignInEnabled: () => false }));
vi.mock("@/lib/meta-pixel", () => ({ metaPixelIds: () => [] }));
vi.mock("@/components/seo/MetaPixel", () => ({ MetaPixel: () => null }));
vi.mock("./RegisterForm", () => ({ RegisterForm: () => null }));

import RegisterPage from "./page";

async function formProps(): Promise<Record<string, unknown>> {
  const el = await RegisterPage({ searchParams: Promise.resolve({}) });
  return el.props.children[0].props;
}

beforeEach(() => {
  jar.ref = undefined;
  db.resolveInvitationCode.mockReset();
});

describe("/register invitation", () => {
  it("prefills the code and shows the bonus for a valid invitation cookie", async () => {
    jar.ref = "ABCD2345";
    db.resolveInvitationCode.mockResolvedValue({ inviterId: "u1" });
    expect(await formProps()).toEqual({ googleEnabled: false, initialReferralCode: "ABCD2345", inviteBonusPct: 110 });
  });

  it("stays the regular page without a cookie, with a malformed one, or when the inviter no longer resolves", async () => {
    expect(await formProps()).toEqual({ googleEnabled: false });
    jar.ref = "not a code";
    expect(await formProps()).toEqual({ googleEnabled: false });
    jar.ref = "ABCD2345";
    db.resolveInvitationCode.mockResolvedValue(null);
    expect(await formProps()).toEqual({ googleEnabled: false });
  });
});
