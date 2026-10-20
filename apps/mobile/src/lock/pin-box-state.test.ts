import { describe, expect, it } from "vitest";
import { nextErrorLook, pinBoxState, type ErrorLook } from "./pin-box-state";

describe("pinBoxState", () => {
  it("marks typed digits filled and the next box active", () => {
    expect([0, 1, 2, 3].map((i) => pinBoxState(i, 2, { error: false, idle: false }))).toEqual(["filled", "filled", "active", "empty"]);
  });

  it("has no active box once all four digits are in", () => {
    expect([0, 1, 2, 3].map((i) => pinBoxState(i, 4, { error: false, idle: false }))).toEqual(["filled", "filled", "filled", "filled"]);
  });

  it("turns only the filled boxes red on error; the active and empty boxes keep their look", () => {
    expect([0, 1, 2, 3].map((i) => pinBoxState(i, 2, { error: true, idle: false }))).toEqual(["error", "error", "active", "empty"]);
  });

  it("idle shows no active box (the lock-setup preview)", () => {
    expect([0, 1, 2, 3].map((i) => pinBoxState(i, 0, { error: false, idle: true }))).toEqual(["empty", "empty", "empty", "empty"]);
  });
});

describe("nextErrorLook", () => {
  const key = 1;
  const shown = (look: ErrorLook | null) => look?.shown ?? false;

  it("shows no error while the error is off", () => {
    expect(nextErrorLook(null, false, key, 2)).toBeNull();
  });

  it("shows the error when it arrives and holds it while the entry is unchanged", () => {
    const first = nextErrorLook(null, true, key, 4);
    expect(shown(first)).toBe(true);
    expect(nextErrorLook(first, true, key, 4)).toBe(first);
  });

  it("clears on the first digit of the next attempt and stays cleared", () => {
    const arrived = nextErrorLook(null, true, key, 0);
    const typed = nextErrorLook(arrived, true, key, 1);
    expect(shown(typed)).toBe(false);
    expect(shown(nextErrorLook(typed, true, key, 2))).toBe(false);
    expect(shown(nextErrorLook(typed, true, key, 0))).toBe(false);
  });

  it("clears when a digit is deleted from a failed full entry", () => {
    const arrived = nextErrorLook(null, true, key, 4);
    expect(shown(nextErrorLook(arrived, true, key, 3))).toBe(false);
  });

  it("arms again for a new error (a different key) after it was cleared", () => {
    const arrived = nextErrorLook(null, true, 1, 0);
    const cleared = nextErrorLook(arrived, true, 1, 1);
    expect(shown(nextErrorLook(cleared, true, 2, 0))).toBe(true);
  });

  it("arms again once the error was switched off and on", () => {
    const arrived = nextErrorLook(null, true, key, 0);
    const cleared = nextErrorLook(arrived, true, key, 1);
    const off = nextErrorLook(cleared, false, key, 0);
    expect(shown(nextErrorLook(off, true, key, 0))).toBe(true);
  });
});
