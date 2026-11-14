// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterForm } from "./RegisterForm";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/seo/MetaPixel", () => ({ trackPixelEvent: vi.fn() }));
vi.mock("@/components/auth/GoogleButton", () => ({ GoogleButton: () => null, OrDivider: () => null }));
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: React.ReactNode }) => children }));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const PASSWORD = "a-strong-password-1";

function fill(props: { portal?: "affiliate" } = {}, referral?: string) {
  render(createElement(RegisterForm, { googleEnabled: false, ...props }));
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Test Person" } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText(/at least/i), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByPlaceholderText(/type it again/i), { target: { value: PASSWORD } });
  if (referral !== undefined) fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: referral } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /create account/i }));
}

const sentBody = (fetch: ReturnType<typeof vi.fn>) => JSON.parse(fetch.mock.calls[0]![1].body as string);

describe("register form", () => {
  it("sends exactly name, email and password when the invitation code is empty", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    fill({}, "   ");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trade"));
    expect(sentBody(fetch)).toEqual({ name: "Test Person", email: "test@example.com", password: PASSWORD });
  });

  it("sends a typed invitation code as referralCode", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    fill({}, " abcd2345 ");
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentBody(fetch)).toEqual({ name: "Test Person", email: "test@example.com", password: PASSWORD, referralCode: "abcd2345" });
  });

  it.each([
    ["invalid_referral", "That invitation code isn't valid."],
    ["self_referral", "You can't use your own invitation code."],
  ])("shows %s on the field, focused and described, and clears it on edit", async (code, error) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error, code }) }));
    fill({}, "ZZZZ9999");
    const message = await screen.findByText(error);
    const input = screen.getByLabelText(/invitation code/i);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(document.activeElement).toBe(input);
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "ZZZZ9998" } });
    expect(screen.queryByText(error)).toBeNull();
  });

  it("shows other server errors in the form banner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Email already registered." }) }));
    fill();
    expect((await screen.findByRole("alert")).textContent).toBe("Email already registered.");
    expect(screen.getByLabelText(/invitation code/i).getAttribute("aria-invalid")).toBeNull();
  });

  it("has no invitation field on the affiliate form and sends the portal flag", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    fill({ portal: "affiliate" });
    expect(screen.queryByLabelText(/invitation code/i)).toBeNull();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/affiliate/dashboard"));
    expect(sentBody(fetch)).toEqual({ name: "Test Person", email: "test@example.com", password: PASSWORD, portal: "affiliate" });
  });
});
