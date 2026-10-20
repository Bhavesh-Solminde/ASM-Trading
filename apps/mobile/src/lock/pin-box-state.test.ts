import { describe, expect, it } from "vitest";
import { pinBoxState } from "./pin-box-state";

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
