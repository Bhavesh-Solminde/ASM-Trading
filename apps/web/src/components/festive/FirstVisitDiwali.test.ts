// @vitest-environment jsdom
import { createElement as h, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIWALI_END, DIWALI_SEEN_KEY, DIWALI_START } from "@/lib/diwali";

const route = vi.hoisted(() => ({ path: "/", reduced: false }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path }));
let Component: typeof import("./FirstVisitDiwali").FirstVisitDiwali;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-08T12:00:00+05:30"));
  route.path = "/"; route.reduced = false;
  localStorage.clear();
  document.cookie = "indianxtrade_diwali_2026_seen=; Path=/; Max-Age=0";
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: route.reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  Component = (await import("./FirstVisitDiwali")).FirstVisitDiwali;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("first-visit Diwali greeting", () => {
  it("shows once under StrictMode, remembers immediately, and stays closed on remount", () => {
    const view = render(h(StrictMode, null, h(Component)));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(localStorage.getItem(DIWALI_SEEN_KEY)).toBe("1");
    expect(document.cookie).toContain("indianxtrade_diwali_2026_seen=1");
    fireEvent.click(screen.getByRole("button", { name: "Skip Diwali greeting" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.unmount(); render(h(Component));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("video")).toBeNull();
  });
  it("does not mount any media for a returning visitor", () => {
    localStorage.setItem(DIWALI_SEEN_KEY, "1"); render(h(Component));
    expect(document.querySelector("video")).toBeNull();
  });
  it("honours the cookie if localStorage is unavailable", () => {
    document.cookie = "indianxtrade_diwali_2026_seen=1; Path=/";
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    render(h(Component)); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each([DIWALI_START - 1, DIWALI_END, DIWALI_END + 86400000])("is disabled outside the campaign at %s", now => {
    vi.setSystemTime(now); render(h(Component)); expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(DIWALI_SEEN_KEY)).toBeNull();
  });
  it.each(["/admin", "/maintenance", "/diwali-preview"])("does not consume a visit on %s", path => {
    route.path = path; render(h(Component)); expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(DIWALI_SEEN_KEY)).toBeNull();
  });
  it("closes on actual video end, not an early wall-clock timeout", () => {
    render(h(Component)); act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.ended(document.querySelector("video")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
  it("offers manual playback for reduced motion and sound only after a click", async () => {
    route.reduced = true; render(h(Component));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play greeting" })).toBeTruthy();
    expect(document.querySelector("video")!.muted).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Turn sound on" })); });
    expect(document.querySelector("video")!.muted).toBe(false);
  });
  it("closes when the campaign expires while the page is open", () => {
    vi.setSystemTime(DIWALI_END - 500); render(h(Component));
    act(() => vi.advanceTimersByTime(501)); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps Continue available when the video fails", () => {
    render(h(Component)); Object.defineProperty(document.querySelector("video")!, "error", { value: { code: 4 }, configurable: true }); fireEvent.error(document.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Continue to website" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
