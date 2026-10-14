import { describe, expect, it } from "vitest";
import { configFrom } from "./config";

describe("configFrom", () => {
  it("reads api/ws urls, version and variant from the expo extra", () => {
    expect(
      configFrom({ version: "1.2.3", extra: { variant: "direct", apiUrl: "https://x.test", wsUrl: "wss://x.test/ws" } }),
    ).toEqual({ apiUrl: "https://x.test", wsUrl: "wss://x.test/ws", version: "1.2.3", variant: "direct" });
  });
  it("strips a trailing slash from the api url", () => {
    expect(configFrom({ version: "1.0.0", extra: { apiUrl: "https://x.test/", wsUrl: "wss://x" } }).apiUrl).toBe(
      "https://x.test",
    );
  });
  it("defaults the variant to play", () => {
    expect(configFrom({ version: "1.0.0", extra: { apiUrl: "a", wsUrl: "b" } }).variant).toBe("play");
  });
});
