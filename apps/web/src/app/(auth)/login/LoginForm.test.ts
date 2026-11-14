// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

const { push, trackLogin } = vi.hoisted(() => ({ push: vi.fn(), trackLogin: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/seo/MetaPixel", () => ({ trackLogin }));
vi.mock("@/components/auth/GoogleButton", () => ({ GoogleButton: () => createElement("a", null, "Google"), OrDivider: () => null }));
vi.mock("@/components/auth/AuthShell", () => ({
  AuthShell: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => createElement("div", null, children, footer),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function submitLogin(portal?: "affiliate") {
  render(createElement(LoginForm, { googleEnabled: true, googleError: false, notice: null, ...(portal ? { portal } : {}) }));
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));
}

describe("login conversion", () => {
  it("records a conversion only after the server accepts the credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    submitLogin();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trade"));
    expect(trackLogin).toHaveBeenCalledExactlyOnceWith("email");
    expect(trackLogin.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!);
  });
  it("does not count rejected credentials as a conversion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Invalid credentials" }) }));
    submitLogin();
    await screen.findByRole("alert");
    expect(trackLogin).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("login portals", () => {
  it("sends exactly email and password from the user portal", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    submitLogin();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trade"));
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ email: "test@example.com", password: "test-password" });
  });

  it("logs affiliates into the affiliate portal, without Google, and lands on their dashboard", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    submitLogin("affiliate");
    expect(screen.queryByText("Google")).toBeNull();
    expect(screen.getByRole("link", { name: /forgot password/i }).getAttribute("href")).toBe("/affiliate/forgot-password");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/affiliate/dashboard"));
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
      email: "test@example.com",
      password: "test-password",
      portal: "affiliate",
    });
  });
});

describe("login cross-links", () => {
  it("points regular users to the affiliate login and affiliates back to /login", () => {
    render(createElement(LoginForm, { googleEnabled: false, googleError: false, notice: null }));
    expect(screen.getByRole("link", { name: "Log in here" }).getAttribute("href")).toBe("/affiliate/login");
    cleanup();
    render(createElement(LoginForm, { googleEnabled: false, googleError: false, notice: null, portal: "affiliate" }));
    expect(screen.getByRole("link", { name: "Log in here" }).getAttribute("href")).toBe("/login");
  });
});
