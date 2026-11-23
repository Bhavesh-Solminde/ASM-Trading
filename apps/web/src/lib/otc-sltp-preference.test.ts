// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { setOtcSltp, useOtcSltp } from "./otc-sltp-preference";

const key = "asm_otc_sltp";
beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("defaults off even with the legacy chart preference enabled", () => {
  localStorage.setItem("asm_chart_protection", "on");
  const { result } = renderHook(useOtcSltp);
  expect(result.current).toBe(false);
  expect(localStorage.getItem(key)).toBeNull();
});

it("updates same-tab consumers and persists an opt-in across remounts", () => {
  const first = renderHook(useOtcSltp);
  const second = renderHook(useOtcSltp);
  act(() => setOtcSltp(true));
  expect(first.result.current).toBe(true);
  expect(second.result.current).toBe(true);
  expect(localStorage.getItem(key)).toBe("on");
  first.unmount();
  expect(renderHook(useOtcSltp).result.current).toBe(true);
  function ServerSnapshot() { return useOtcSltp() ? "on" : "off"; }
  expect(renderToString(createElement(ServerSnapshot))).toBe("off");
});

it("follows storage events from other tabs and ignores the legacy key", () => {
  const { result } = renderHook(useOtcSltp);
  act(() => {
    localStorage.setItem(key, "on");
    window.dispatchEvent(new StorageEvent("storage", { key: "asm_chart_protection" }));
  });
  expect(result.current).toBe(false);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  expect(result.current).toBe(true);
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(result.current).toBe(false);
});
