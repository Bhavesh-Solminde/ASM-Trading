import { beforeEach, describe, expect, it } from "vitest";
import { listLoadedFor, useListLoaded } from "./list-loaded-store";

describe("listLoadedFor", () => {
  it("is true for the account whose list Trade published", () => {
    expect(listLoadedFor("live-1", "live-1", "demo-1")).toBe(true);
  });
  it("is true for the bootstrap account, whose list bootstrap carries", () => {
    expect(listLoadedFor(null, "demo-1", "demo-1")).toBe(true);
  });
  it("is false for another account until Trade has published it", () => {
    expect(listLoadedFor(null, "live-1", "demo-1")).toBe(false);
    expect(listLoadedFor("demo-1", "live-1", "demo-1")).toBe(false);
  });
  it("is false with no account yet", () => {
    expect(listLoadedFor("live-1", undefined, "demo-1")).toBe(false);
  });
});

describe("useListLoaded store", () => {
  beforeEach(() => useListLoaded.setState({ loadedFor: null }));

  it("starts empty and holds the last published account id", () => {
    expect(useListLoaded.getState().loadedFor).toBeNull();
    useListLoaded.getState().set("live-1");
    expect(useListLoaded.getState().loadedFor).toBe("live-1");
    useListLoaded.getState().set(null);
    expect(useListLoaded.getState().loadedFor).toBeNull();
  });
});
