import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const saved = process.env["META_PIXEL_ID"];

afterEach(() => {
  if (saved === undefined) delete process.env["META_PIXEL_ID"];
  else process.env["META_PIXEL_ID"] = saved;
});

describe("GET /api/meta-pixel", () => {
  it("reads the pixel IDs on each request and lets the browser cache them briefly", async () => {
    process.env["META_PIXEL_ID"] = "1137830615432603, not-an-id";
    const res = GET();
    expect(await res.json()).toEqual({ pixelIds: ["1137830615432603"] });
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    process.env["META_PIXEL_ID"] = "1176260014975763";
    expect(await GET().json()).toEqual({ pixelIds: ["1176260014975763"] });
  });

  it("answers an empty list when no pixel is configured", async () => {
    delete process.env["META_PIXEL_ID"];
    expect(await GET().json()).toEqual({ pixelIds: [] });
  });
});
