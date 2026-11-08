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
    fireEvent.click(screen.getByRole("button", { name: "Close Diwali greeting" }));
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
  it("shows only the video and one Close button", () => {
    render(h(Component));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Close Diwali greeting" })).toBeTruthy();
    expect(document.querySelector("video")!.controls).toBe(false);
  });
  it("uses the poster without autoplay for reduced motion", () => {
    route.reduced = true; render(h(Component));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("falls back to muted autoplay when the browser rejects sound", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("NotAllowedError"));
    await act(async () => { render(h(Component)); });
    expect(document.querySelector("video")!.muted).toBe(true);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("unmutes directly on a video tap after blocked autoplay, with one Close button", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await act(async () => { render(h(Component)); });
    expect(document.querySelector("video")!.muted).toBe(true);
    expect(screen.getByText("Tap video for sound")).toBeTruthy();
    await act(async () => { fireEvent.click(document.querySelector("video")!); });
    expect(document.querySelector("video")!.muted).toBe(false);
    expect(document.querySelector("video")!.volume).toBe(1);
    expect(screen.queryByText("Tap video for sound")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("supports keyboard sound activation", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await act(async () => { render(h(Component)); });
    await act(async () => { fireEvent.keyDown(document.querySelector("video")!, { key: "Enter" }); });
    expect(document.querySelector("video")!.muted).toBe(false);
  });
  it("does not let a stale StrictMode play rejection mute the current video", async () => {
    let rejectOld: (error: Error) => void = () => {};
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject; }));
    await act(async () => { render(h(StrictMode, null, h(Component))); });
    await act(async () => { rejectOld(new DOMException("interrupted", "AbortError")); });
    expect(document.querySelector("video")!.muted).toBe(false);
    expect(screen.queryByText("Tap video for sound")).toBeNull();
  });
  it("closes when the campaign expires while the page is open", () => {
    vi.setSystemTime(DIWALI_END - 500); render(h(Component));
    act(() => vi.advanceTimersByTime(501)); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps Close available when the video fails", () => {
    render(h(Component)); Object.defineProperty(document.querySelector("video")!, "error", { value: { code: 4 }, configurable: true }); fireEvent.error(document.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Close Diwali greeting" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
