import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), set: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/admin-session", () => ({ ADMIN_SESSION_COOKIE: "admin", readAdminSession: mocks.auth }));
vi.mock("@/lib/password", () => ({ hashPassword: vi.fn() }));
vi.mock("@asm/db", () => ({
  AffiliateCreationRefused: class AffiliateCreationRefused extends Error {},
  setAffiliateAccountBalance: mocks.set,
}));
import { AffiliateCreationRefused } from "@asm/db";
import { setAffiliateBalanceAction } from "./actions";

function form(amount = "25000.01") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ amount, accountId: "account", currency: "INR", requestId: "request" })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(true);
  mocks.set.mockResolvedValue(undefined);
});
describe("admin affiliate balance action", () => {
  it("requires an authenticated admin before changing funds", async () => {
    mocks.auth.mockResolvedValue(false);
    await expect(setAffiliateBalanceAction(form())).rejects.toThrow("Not authorised");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it.each([["25000.01", 2500001], ["0", 0], ["0.29", 29], ["123.4", 12340]])("parses %s exactly into minor units", async (amount, balanceMinor) => {
    await expect(setAffiliateBalanceAction(form(amount))).rejects.toThrow("redirect:/admin/affiliates?balance=1");
    expect(mocks.set).toHaveBeenCalledWith({ accountId: "account", currency: "INR", requestId: "request", balanceMinor });
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/affiliates");
  });
  it.each(["", "-1", "1.001", "1e4", "NaN", "Infinity", "1,000", "90071992547410", "9".repeat(40)])("rejects invalid amount %s", async amount => {
    await expect(setAffiliateBalanceAction(form(amount))).rejects.toThrow("redirect:/admin/affiliates?error=");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("shows refused updates without reporting success", async () => {
    mocks.set.mockRejectedValue(new AffiliateCreationRefused("Account currency changed"));
    await expect(setAffiliateBalanceAction(form())).rejects.toThrow("redirect:/admin/affiliates?error=Account%20currency%20changed");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
