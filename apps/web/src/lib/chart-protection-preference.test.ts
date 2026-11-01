// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setChartProtection, useChartProtection } from "./chart-protection-preference";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("defaults on without persisting or setting trade protection", () => {
  const { result } = renderHook(useChartProtection);
  expect(result.current).toBe(true); expect(localStorage.getItem("asm_chart_protection")).toBeNull();
});
it("updates mounted consumers and persists the visibility preference across remounts", () => {
  const first = renderHook(useChartProtection);
  const second = renderHook(useChartProtection);
  act(() => setChartProtection(false));
  expect(first.result.current).toBe(false); expect(second.result.current).toBe(false);
  first.unmount(); const restored = renderHook(useChartProtection); expect(restored.result.current).toBe(false);
  act(() => setChartProtection(true)); expect(restored.result.current).toBe(true);
});
it("synchronizes changes from another tab, including resetting preferences", () => {
  const { result } = renderHook(useChartProtection);
  act(() => { localStorage.setItem("asm_chart_protection", "off"); window.dispatchEvent(new StorageEvent("storage", { key: "asm_chart_protection" })); });
  expect(result.current).toBe(false);
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
  expect(result.current).toBe(true);
});
it("remains usable when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const { result } = renderHook(useChartProtection); expect(result.current).toBe(true);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(() => setChartProtection(false)).not.toThrow();
});
