import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/errors";
import { UPLOAD_TIMEOUT_MS, kycUploadParts, uploadErrorText } from "./upload-model";

const t = (key: string) => `t:${key}`;

describe("UPLOAD_TIMEOUT_MS", () => {
  it("allows 30 seconds, since a photo goes over mobile data", () => {
    expect(UPLOAD_TIMEOUT_MS).toBe(30_000);
  });
});

describe("kycUploadParts", () => {
  it("sends the kind and a jpeg file record named after the kind", () => {
    expect(kycUploadParts("PAN", "file:///cache/a.jpg")).toEqual({
      kind: "PAN",
      file: { uri: "file:///cache/a.jpg", name: "pan.jpg", type: "image/jpeg" },
    });
    expect(kycUploadParts("AADHAAR_BACK", "file:///b.jpg").file.name).toBe("aadhaar_back.jpg");
  });
});

describe("uploadErrorText", () => {
  it("translates offline, timeout and server errors", () => {
    expect(uploadErrorText(new ApiError("No connection.", 0, "offline"), t)).toBe("t:common.noConnection");
    expect(uploadErrorText(new ApiError("The request timed out.", 0, "timeout"), t)).toBe("t:kyc.uploadTimedOut");
    expect(uploadErrorText(new ApiError("boom", 500, "server_error"), t)).toBe("t:common.genericError");
    expect(uploadErrorText(new Error("x"), t)).toBe("t:common.genericError");
  });
  it("shows the server's own message for a 413 (too large) or 400 (wrong type, missing part)", () => {
    expect(uploadErrorText(new ApiError("Photo is too large — keep it under 8MB.", 413, "bad_request"), t)).toBe(
      "Photo is too large — keep it under 8MB.",
    );
    expect(uploadErrorText(new ApiError("Use a JPEG, PNG or WebP photo.", 400, "bad_request"), t)).toBe("Use a JPEG, PNG or WebP photo.");
  });
  it("shows a 409 lock message (details locked while in review) verbatim too", () => {
    expect(uploadErrorText(new ApiError("Your identity details are locked while they are in review or verified.", 409, "conflict"), t)).toBe(
      "Your identity details are locked while they are in review or verified.",
    );
  });
  it("falls back to the translated generic text when a 4xx carries no message", () => {
    expect(uploadErrorText(new ApiError("Something went wrong.", 400, "bad_request"), t)).toBe("t:common.genericError");
  });
});
