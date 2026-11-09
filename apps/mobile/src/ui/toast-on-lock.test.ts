import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { clearOnLock } from "./toast-on-lock";

const make = () => create<{ locked: boolean; other: number }>(() => ({ locked: false, other: 0 }));

describe("clearOnLock", () => {
  it("clears the toasts when the app relocks, so a result toast never draws over /lock", () => {
    const store = make();
    const clear = vi.fn();
    clearOnLock(store, clear);
    store.setState({ locked: true });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does nothing for other changes, an unlock, or a repeated locked state", () => {
    const store = make();
    const clear = vi.fn();
    clearOnLock(store, clear);
    store.setState({ other: 1 });
    store.setState({ locked: true });
    store.setState({ locked: true, other: 2 });
    store.setState({ locked: false });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("stops after the returned unsubscribe", () => {
    const store = make();
    const clear = vi.fn();
    clearOnLock(store, clear)();
    store.setState({ locked: true });
    expect(clear).not.toHaveBeenCalled();
  });
});
