// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

const { push, trackLogin } = vi.hoisted(() => ({ push: vi.fn(), trackLogin: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/seo/MetaPixel", () => ({ trackLogin }));
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: React.ReactNode }) => children }));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function submitLogin() {
  render(createElement(LoginForm, { googleEnabled: false, googleError: false, notice: null }));
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
