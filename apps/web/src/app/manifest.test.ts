import { describe, expect, it } from "vitest";
import manifest from "./manifest";
describe("installed app manifest", () => {
  it("starts on trading and includes maskable icons", () => {
    expect(manifest()).toMatchObject({
      id: "/?app=pwa",
      scope: "/",
      start_url: "/trade?source=pwa",
      display: "standalone",
      orientation: "portrait",
    });
    expect(
      manifest().icons?.some(
        (i) => i.purpose === "maskable" && i.sizes === "512x512",
      ),
    ).toBe(true);
  });
});
