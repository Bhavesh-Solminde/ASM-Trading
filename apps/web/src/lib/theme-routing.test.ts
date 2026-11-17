// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let theme: typeof import("./theme");
let channels: { onmessage?: (event: { data: unknown }) => void; postMessage: ReturnType<typeof vi.fn> }[];
beforeEach(async () => {
  vi.resetModules();
  channels = [];
  vi.stubGlobal("BroadcastChannel", class {
    onmessage?: (event: { data: unknown }) => void;
    postMessage = vi.fn();
    constructor() { channels.push(this); }
  });
  let frame = 0;
  vi.stubGlobal("requestAnimationFrame", () => ++frame);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  window.history.replaceState(null, "", "/trade");
  document.documentElement.dataset.theme = "dark";
  document.head.innerHTML = '<meta name="theme-color" content="initial">';
  document.documentElement.style.setProperty("--color-ground", "theme-ground");
  document.cookie = "ixt_theme=; Max-Age=0; Path=/";
  document.cookie = "ixt_start_theme=; Max-Age=0; Path=/";
  theme = await import("./theme");
});
afterEach(() => { Reflect.deleteProperty(document, "cookie"); vi.unstubAllGlobals(); });

it("reads later cookie changes instead of retaining an earlier persisted session choice", () => {
  theme.setTheme("dark");
  document.cookie = "ixt_theme=light; Path=/";
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("light");
});
it.each([true, false])("keeps a blocked-cookie choice across route changes (throws=%s)", throws => {
  Object.defineProperty(document, "cookie", { configurable: true, get: () => "ixt_theme=dark", set: () => { if (throws) throw new Error("blocked"); } });
  theme.setTheme("light");
  window.history.replaceState(null, "", "/account");
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("light");
  window.history.replaceState(null, "", "/admin/login");
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("dark");
  window.history.replaceState(null, "", "/trade");
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("light");
});
it("remembers cross-tab messages on admin without writing cookies or changing its appearance", () => {
  const stop = theme.subscribe(vi.fn());
  window.history.replaceState(null, "", "/admin/login");
  const setter = vi.fn();
  Object.defineProperty(document, "cookie", { configurable: true, get: () => "ixt_theme=dark", set: setter });
  channels[0]!.onmessage?.({ data: "light" });
  theme.setTheme("light");
  expect(setter).not.toHaveBeenCalled();
  expect(theme.readTheme()).toBe("dark");
  window.history.replaceState(null, "", "/trade");
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("light");
  expect(setter).not.toHaveBeenCalled();
  stop();
});
it("applies one cross-tab notification without broadcasting it again", () => {
  const listener = vi.fn(), stop = theme.subscribe(listener);
  channels[0]!.onmessage?.({ data: "light" });
  channels[0]!.onmessage?.({ data: "light" });
  channels[0]!.onmessage?.({ data: "invalid" });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(channels[0]!.postMessage).not.toHaveBeenCalled();
  expect(theme.readTheme()).toBe("light");
  stop();
});
it("uses the device default on /start with blocked cookie reads, then restores the global default", () => {
  Object.defineProperty(document, "cookie", { configurable: true, get: () => { throw new Error("blocked"); } });
  window.history.replaceState(null, "", "/start");
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("light");
  window.history.replaceState(null, "", "/login");
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("dark");
});
it("leaves the legacy /start cookie read-only and lets the global cookie win", () => {
  document.cookie = "ixt_start_theme=light; Path=/";
  window.history.replaceState(null, "", "/start");
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("light");
  expect(document.cookie).not.toContain("ixt_theme=");
  document.cookie = "ixt_theme=dark; Path=/";
  theme.syncRouteTheme();
  expect(theme.readTheme()).toBe("dark");
});
it("boots /start/ from the device default and defers chrome until CSS has resolved", async () => {
  const { themeBootstrap } = await import("./theme-bootstrap");
  window.history.replaceState(null, "", "/start/");
  document.documentElement.style.removeProperty("--color-ground");
  const listen = vi.spyOn(document, "addEventListener");
  new Function(themeBootstrap)();
  expect(theme.readTheme()).toBe("light");
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("initial");
  const ready = listen.mock.calls.find(([name]) => name === "DOMContentLoaded")?.[1] as EventListener;
  document.documentElement.style.setProperty("--color-ground", "resolved-ground");
  ready(new Event("DOMContentLoaded"));
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("resolved-ground");
  listen.mockRestore();
});
it("deduplicates theme-color after metadata hydration and later streamed insertion", async () => {
  const serverMeta = document.querySelector('meta[name="theme-color"]');
  const hydrated = document.createElement("meta");
  hydrated.name = "theme-color"; hydrated.content = "server-dark";
  document.head.append(hydrated);
  theme.syncRouteTheme();
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  expect(serverMeta?.isConnected).toBe(false);
  expect(hydrated.content).toBe("theme-ground");
  const stop = theme.watchThemeChrome();
  const streamed = document.createElement("meta");
  streamed.name = "theme-color"; streamed.content = "streamed-dark";
  document.head.append(streamed);
  await Promise.resolve();
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  expect(streamed.content).toBe("theme-ground");
  expect(hydrated.isConnected).toBe(false);
  stop();
});
it.each([
  ["/login", "session=x; ixt_theme=light; other=1", "light"],
  ["/login", "session=x; ixt_theme=lightning", "dark"],
  ["/start", "session=x; ixt_start_theme=light; other=1", "light"],
  ["/start/", "session=x; ixt_start_theme=light; other=1", "light"],
  ["/start", "ixt_theme=dark; ixt_start_theme=light", "dark"],
  ["/admin/login", "session=x; ixt_theme=light", "dark"],
])("runs the exact bootstrap with cookies before the preference: %s", async (pathname, cookie, expected) => {
  const { themeBootstrap } = await import("./theme-bootstrap");
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const fake = { cookie, documentElement: root, querySelector: () => null, addEventListener: vi.fn() };
  const boot = new Function("document", "location", "matchMedia", "getComputedStyle", themeBootstrap);
  boot(fake, { pathname }, () => ({ matches: false }), () => ({ getPropertyValue: () => "" }));
  expect(root.dataset.theme ?? "dark").toBe(expected);
});

it("restores chrome when React changes the existing meta content after navigation", async () => {
  theme.syncRouteTheme();
  const stop = theme.watchThemeChrome();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!;
  meta.content = "react-server-dark";
  await Promise.resolve();
  expect(meta.content).toBe("theme-ground");
  // The observer's own correction must settle without repeated writes.
  await Promise.resolve();
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  expect(meta.content).toBe("theme-ground");
  stop();
});
