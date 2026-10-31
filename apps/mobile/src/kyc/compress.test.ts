import { describe, expect, it } from "vitest";
import { ATTEMPTS, MAX_BYTES, compressWith, fitResize } from "./compress";

describe("ATTEMPTS", () => {
  it("mirrors the web uploader: five encodes from 1600px/0.85 down to 800px/0.55, in order", () => {
    expect(ATTEMPTS).toEqual([
      [1600, 0.85],
      [1600, 0.7],
      [1280, 0.7],
      [1024, 0.6],
      [800, 0.55],
    ]);
  });
  it("keeps the budget under nginx's 1 MB body limit", () => {
    expect(MAX_BYTES).toBe(900_000);
  });
});

describe("compressWith", () => {
  it("stops at the first attempt that fits and never runs the rest", async () => {
    const tried: Array<[number, number]> = [];
    const out = await compressWith(async (side, quality) => {
      tried.push([side, quality]);
      return { uri: `s${side}q${quality}`, bytes: side > 1280 ? 1_200_000 : 800_000 };
    });
    expect(tried).toEqual([
      [1600, 0.85],
      [1600, 0.7],
      [1280, 0.7],
    ]);
    expect(out).toEqual({ uri: "s1280q0.7", bytes: 800_000 });
  });
  it("accepts a result of exactly 900,000 bytes", async () => {
    const out = await compressWith(async () => ({ uri: "x", bytes: 900_000 }));
    expect(out?.uri).toBe("x");
  });
  it("returns null when no attempt fits, so the screen asks for a retake and never uploads", async () => {
    let runs = 0;
    const out = await compressWith(async () => {
      runs += 1;
      return { uri: "big", bytes: 2_000_000 };
    });
    expect(out).toBeNull();
    expect(runs).toBe(ATTEMPTS.length);
  });
  it("does not accept an empty file as a fit", async () => {
    const out = await compressWith(async () => ({ uri: "empty", bytes: 0 }));
    expect(out).toBeNull();
  });
  it("lets a failed encode surface to the caller", async () => {
    await expect(compressWith(async () => Promise.reject(new Error("decode failed")))).rejects.toThrow("decode failed");
  });
});

describe("fitResize", () => {
  it("caps the long side of a landscape photo by width", () => {
    expect(fitResize(4000, 3000, 1600)).toEqual({ width: 1600 });
  });
  it("caps the long side of a portrait photo by height", () => {
    expect(fitResize(3000, 4000, 1600)).toEqual({ height: 1600 });
  });
  it("treats a square as landscape", () => {
    expect(fitResize(2000, 2000, 1024)).toEqual({ width: 1024 });
  });
  it("never enlarges an image already smaller than the cap", () => {
    expect(fitResize(1000, 700, 1600)).toEqual({ width: 1000 });
    expect(fitResize(700, 1000, 1600)).toEqual({ height: 1000 });
  });
});
