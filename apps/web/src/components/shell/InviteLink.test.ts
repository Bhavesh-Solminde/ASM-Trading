// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton, InviteLink } from "./InviteLink";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
}

describe("CopyButton", () => {
  it("copies the value, confirms, then resets", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(createElement(CopyButton, { value: "https://x.test/invite/ABCD2345" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy link" })));
    expect(writeText).toHaveBeenCalledWith("https://x.test/invite/ABCD2345");
    expect(screen.getByRole("button").textContent).toBe("Copied!");
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button").textContent).toBe("Copy link");
  });

  it("says so when the clipboard is blocked instead of claiming success", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(createElement(CopyButton, { value: "v" }));
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("button").textContent).toBe("Copy failed");
  });
});

describe("InviteLink", () => {
  it("shows the full link and the code", () => {
    render(createElement(InviteLink, { code: "ABCD2345", url: "https://x.test/invite/ABCD2345" }));
    expect(screen.getByText("https://x.test/invite/ABCD2345")).toBeTruthy();
    expect(screen.getByText("ABCD2345")).toBeTruthy();
  });
});
