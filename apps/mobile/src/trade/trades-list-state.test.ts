import { describe, expect, it } from "vitest";
import { tradesListState } from "./trades-list-state";

describe("tradesListState", () => {
  it("shows rows whenever there are any, even if the full list has not loaded", () => {
    expect(tradesListState(3, true)).toBe("rows");
    expect(tradesListState(3, false)).toBe("rows");
  });

  it("shows the empty copy only when the list is empty and nothing is pending", () => {
    expect(tradesListState(0, false)).toBe("empty");
  });

  it("shows loading, not 'No trades', when the list is empty and still pending", () => {
    expect(tradesListState(0, true)).toBe("loading");
  });
});
