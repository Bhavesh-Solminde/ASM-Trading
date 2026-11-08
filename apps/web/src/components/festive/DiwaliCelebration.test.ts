// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const audio = vi.hoisted(() => ({ stop: vi.fn(), play: vi.fn(), ready: true, muted: false, listeners: new Set<() => void>() }));
vi.mock("@/lib/festive-sound", () => ({ prepareFireworkSound: async () => audio.ready, playFireworkSound: () => { audio.play(); return audio.stop; } }));
vi.mock("@/lib/sound", () => ({ isMuted: () => audio.muted, setMuted: (on: boolean) => { audio.muted = on; audio.listeners.forEach(fn => fn()); }, subscribeSound: (fn: () => void) => { audio.listeners.add(fn); return () => audio.listeners.delete(fn); } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import Celebration from "./DiwaliCelebration";
import { FESTIVAL_SOUND_KEY, FESTIVAL_MOTION_KEY } from "@/lib/festive-preferences";

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); audio.muted = false; audio.ready = true; localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function launch() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Celebrate with sound" })); }); }

describe("Diwali playback and preferences", () => {
  it("plays one sequence, persists sound consent and prevents repeated launch", async () => {
    render(h(Celebration, { onClose() {} })); await launch(); await launch();
    expect(audio.play).toHaveBeenCalledTimes(1); expect(localStorage.getItem(FESTIVAL_SOUND_KEY)).toBe("on");
    act(() => vi.advanceTimersByTime(3000)); expect(audio.stop).toHaveBeenCalled();
    expect((screen.getByText("Play quietly") as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(2000)); expect((screen.getByText("Play quietly") as HTMLButtonElement).disabled).toBe(false);
  });
  it("never enables audio for quiet playback", async () => {
    render(h(Celebration, { onClose() {} }));
    fireEvent.click(screen.getByText("Play quietly")); expect(audio.play).not.toHaveBeenCalled(); expect(localStorage.getItem(FESTIVAL_SOUND_KEY)).toBeNull();
  });
  it("stops currently playing sources immediately when the site is muted", async () => {
    render(h(Celebration, { onClose() {} })); await launch(); audio.stop.mockClear();
    act(() => { audio.muted = true; audio.listeners.forEach(fn => fn()); }); expect(audio.stop).toHaveBeenCalled();
    expect((screen.getByText("Celebrate with sound") as HTMLButtonElement).disabled).toBe(true);
  });
  it("cancels sound/timers and restores body scroll on unmount", async () => {
    const view=render(h(Celebration, { onClose() {} })); await launch(); view.unmount();
    expect(audio.stop).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); expect(document.body.style.overflow).toBe("");
  });
  it("cancels when hidden and does not queue playback", async () => {
    render(h(Celebration, { onClose() {} })); await launch(); audio.stop.mockClear();
    vi.spyOn(document,"hidden","get").mockReturnValue(true); fireEvent(document,new Event("visibilitychange"));
    expect(audio.stop).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("disables animations and sound when motion is turned off", async () => {
    render(h(Celebration, { onClose() {} })); await launch(); fireEvent.click(screen.getByText("Animation on"));
    expect(localStorage.getItem(FESTIVAL_MOTION_KEY)).toBe("off"); expect(audio.stop).toHaveBeenCalled();
    expect((screen.getByText("Play quietly") as HTMLButtonElement).disabled).toBe(true);
  });
  it("handles unavailable audio without persisting consent", async () => {
    audio.ready=false; render(h(Celebration, { onClose() {} })); await launch();
    expect(audio.play).not.toHaveBeenCalled(); expect(localStorage.getItem(FESTIVAL_SOUND_KEY)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("couldn't start");
  });
});
