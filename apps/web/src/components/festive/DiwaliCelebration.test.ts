// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sound = vi.hoisted(() => ({ stop: vi.fn(), muted: false, listener: () => {} }));
vi.mock("@/lib/sound", () => ({
  isMuted: () => sound.muted,
  prepareFestivalSound: async () => true,
  playFireworks: () => sound.stop,
  setMuted: (next: boolean) => { sound.muted = next; sound.listener(); },
  subscribeSound: (fn: () => void) => { sound.listener = fn; return () => {}; },
}));
import Celebration from "./DiwaliCelebration";

beforeEach(() => {
  vi.useFakeTimers(); sound.muted = false; sound.stop.mockClear(); localStorage.clear();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function launch() {
  await act(async () => { fireEvent.click(screen.getByText("Celebrate with sound")); });
}
describe("Diwali celebration lifecycle", () => {
  it("prevents stacked playback and allows replay after the cooldown", async () => {
    render(createElement(Celebration, { onClose() {} })); await launch();
    expect((screen.getByText("Play quietly") as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(3000)); expect(sound.stop).toHaveBeenCalled();
    expect((screen.getByText("Play quietly") as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect((screen.getByText("Play quietly") as HTMLButtonElement).disabled).toBe(false);
  });
  it("stops sound immediately when global mute changes", async () => {
    render(createElement(Celebration, { onClose() {} })); await launch(); sound.stop.mockClear();
    act(() => { sound.muted = true; sound.listener(); });
    expect(sound.stop).toHaveBeenCalledTimes(1);
    expect((screen.getByText("Celebrate with sound") as HTMLButtonElement).disabled).toBe(true);
  });
  it("cancels scheduled playback and timers on unmount", async () => {
    const view = render(createElement(Celebration, { onClose() {} })); await launch(); sound.stop.mockClear();
    view.unmount(); expect(sound.stop).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels when the tab is hidden", async () => {
    render(createElement(Celebration, { onClose() {} })); await launch(); sound.stop.mockClear();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(sound.stop).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
