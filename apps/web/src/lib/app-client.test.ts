import { describe, expect, it } from "vitest";
import { appVersionFrom, compareVersions, deviceNameFrom, isAppRequest } from "./app-client";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("appVersionFrom", () => {
  it("reads the version from an app client header", () => {
    expect(appVersionFrom(h({ "x-client": "app/1.4.0" }))).toBe("1.4.0");
  });
  it("ignores missing or malformed headers", () => {
    expect(appVersionFrom(h({}))).toBeNull();
    expect(appVersionFrom(h({ "x-client": "web" }))).toBeNull();
    expect(appVersionFrom(h({ "x-client": "app/1.4" }))).toBeNull();
  });
});

describe("isAppRequest", () => {
  it("is true only for a well-formed app client header", () => {
    expect(isAppRequest(h({ "x-client": "app/0.1.0" }))).toBe(true);
    expect(isAppRequest(h({ "x-client": "app/" }))).toBe(false);
  });
});

describe("deviceNameFrom", () => {
  it("trims and caps the device name at 80 characters", () => {
    expect(deviceNameFrom(h({ "x-device-name": "  Pixel 8  " }))).toBe("Pixel 8");
    expect(deviceNameFrom(h({ "x-device-name": "x".repeat(200) }))?.length).toBe(80);
    expect(deviceNameFrom(h({}))).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
  });
});
