import { describe, expect, it } from "vitest";
import { listStateKind } from "./list-state";

describe("listStateKind", () => {
  it("shows skeletons while loading, whatever else is set", () => {
    expect(listStateKind({ loading: true, error: false, empty: "none" })).toBe("loading");
    expect(listStateKind({ loading: true, error: true, empty: "none" })).toBe("loading");
  });
  it("shows the retry state on an error", () => {
    expect(listStateKind({ loading: false, error: true, empty: "none" })).toBe("error");
  });
  it("shows the empty text only when the caller passes one", () => {
    expect(listStateKind({ loading: false, error: false, empty: "No payments yet" })).toBe("empty");
    expect(listStateKind({ loading: false, error: false })).toBe("none");
    expect(listStateKind({ loading: false, error: false, empty: "" })).toBe("none");
  });
});
