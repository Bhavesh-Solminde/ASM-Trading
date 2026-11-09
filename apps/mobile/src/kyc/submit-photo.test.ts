import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { knownSize } from "./compress";
import { submitPhoto } from "./submit-photo";

const t = (key: string) => `<${key}>`;
const COMPRESSED = { uri: "file:///c.jpg", bytes: 400_000 };

describe("knownSize", () => {
  it("returns a real size", () => {
    expect(knownSize(123_456)).toBe(123_456);
  });
  it("throws when the platform cannot say how big the file is (null or missing), so it is never mistaken for 'too large'", () => {
    expect(() => knownSize(null)).toThrow();
    expect(() => knownSize(undefined)).toThrow();
    expect(() => knownSize(Number.NaN)).toThrow();
  });
});

describe("submitPhoto", () => {
  it("compresses, uploads the compressed file and reports done with it", async () => {
    const compress = vi.fn(async () => COMPRESSED);
    const upload = vi.fn(async () => {});
    const out = await submitPhoto({ cached: null, compress, upload, t });
    expect(out).toEqual({ status: "done", compressed: COMPRESSED });
    expect(upload).toHaveBeenCalledWith(COMPRESSED.uri);
    expect(compress).toHaveBeenCalledTimes(1);
  });
  it("does not compress again on a retry: it uploads the file it already has", async () => {
    const compress = vi.fn(async () => COMPRESSED);
    const upload = vi.fn(async () => {});
    await submitPhoto({ cached: COMPRESSED, compress, upload, t });
    expect(compress).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(COMPRESSED.uri);
  });
  it("says 'too large, retake' when nothing fits, and uploads nothing", async () => {
    const upload = vi.fn(async () => {});
    const out = await submitPhoto({ cached: null, compress: async () => null, upload, t });
    expect(out).toEqual({ status: "failed", message: "<kyc.photoTooLarge>", compressed: null });
    expect(upload).not.toHaveBeenCalled();
  });
  it("says something went wrong, not 'too large', when the compression itself fails (unknown file size, a bad image)", async () => {
    const upload = vi.fn(async () => {});
    const out = await submitPhoto({
      cached: null,
      compress: async () => {
        throw new Error("unknown size");
      },
      upload,
      t,
    });
    expect(out).toEqual({ status: "failed", message: "<common.genericError>", compressed: null });
    expect(upload).not.toHaveBeenCalled();
  });
  it("keeps the compressed file when the upload fails, with the upload's own text", async () => {
    const out = await submitPhoto({
      cached: null,
      compress: async () => COMPRESSED,
      upload: async () => {
        throw new ApiError("The request timed out.", 0, "timeout");
      },
      t,
    });
    expect(out).toEqual({ status: "failed", message: "<kyc.uploadTimedOut>", compressed: COMPRESSED });
  });
  it("shows a server 4xx message as it is", async () => {
    const out = await submitPhoto({
      cached: COMPRESSED,
      compress: async () => COMPRESSED,
      upload: async () => {
        throw new ApiError("Your details are already in review.", 409, null);
      },
      t,
    });
    expect(out).toEqual({ status: "failed", message: "Your details are already in review.", compressed: COMPRESSED });
  });
});
