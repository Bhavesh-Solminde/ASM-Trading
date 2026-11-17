// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { themeBootstrap } from "./theme-bootstrap";
import { cookieTheme, readTheme, setTheme, subscribe } from "./theme";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.documentElement.style.setProperty("--color-ground", "light-ground");
  document.head.innerHTML = '<meta name="theme-color" content="dark-ground">';
  document.cookie = "ixt_theme=; Max-Age=0; Path=/";
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
});
describe("theme store", () => {
  it.each(["", "ixt_theme=wat", "ixt_theme=lightning", "other_ixt_theme=light", "ixt_theme=LIGHT"])("rejects missing/invalid preference %s", (cookie) => {
    expect(cookieTheme(cookie)).toBe("dark");
  });
  it("strictly accepts the cookie among other cookies", () => expect(cookieTheme("a=1; ixt_theme=light; b=2")).toBe("light"));
  it("updates document, chrome, cookie, and emits once per change", () => {
    const listener = vi.fn(); const stop = subscribe(listener);
    setTheme("light"); setTheme("light");
    expect(readTheme()).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("light-ground");
    expect(document.cookie).toContain("ixt_theme=light");
    expect(listener).toHaveBeenCalledTimes(1);
    stop(); setTheme("dark"); expect(listener).toHaveBeenCalledTimes(1);
  });
  it("still switches when persistence throws", () => {
    Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: () => { throw new Error("blocked"); } });
    try { expect(() => setTheme("light")).not.toThrow(); expect(readTheme()).toBe("light"); }
    finally { Reflect.deleteProperty(document, "cookie"); }
  });
});
describe("exact blocking bootstrap", () => {
  it.each(["", "ixt_theme=bad", "ixt_theme=lightning", "ixt_theme=dark", "ixt_theme=light"])("handles %s without hydration state", (cookie) => {
    document.cookie = cookie;
    new Function(themeBootstrap)();
    expect(readTheme()).toBe(cookie === "ixt_theme=light" ? "light" : "dark");
  });
  it("catches blocked cookie reads", () => {
    Object.defineProperty(document, "cookie", { configurable: true, get: () => { throw new Error("blocked"); } });
    try { expect(() => new Function(themeBootstrap)()).not.toThrow(); expect(readTheme()).toBe("dark"); }
    finally { Reflect.deleteProperty(document, "cookie"); }
  });
});
