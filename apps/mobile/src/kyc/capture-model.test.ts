import { describe, expect, it } from "vitest";
import { cameraFacing, cameraMounted, captureHintKey, captureKind, captureTitleKey, guideBox, permissionView, scrimRects, shutterEnabled, torchAvailable } from "./capture-model";

describe("captureKind", () => {
  it("accepts the four document kinds", () => {
    expect(captureKind("AADHAAR_FRONT")).toBe("AADHAAR_FRONT");
    expect(captureKind("AADHAAR_BACK")).toBe("AADHAAR_BACK");
    expect(captureKind("PAN")).toBe("PAN");
    expect(captureKind("SELFIE")).toBe("SELFIE");
  });
  it("takes the first of a repeated param and rejects anything else", () => {
    expect(captureKind(["PAN", "SELFIE"])).toBe("PAN");
    expect(captureKind("pan")).toBeNull();
    expect(captureKind("PASSPORT")).toBeNull();
    expect(captureKind("")).toBeNull();
    expect(captureKind(undefined)).toBeNull();
    expect(captureKind([])).toBeNull();
  });
});

describe("camera choices", () => {
  it("uses the front camera for the selfie and the back camera for documents", () => {
    expect(cameraFacing("SELFIE")).toBe("front");
    expect(cameraFacing("PAN")).toBe("back");
    expect(cameraFacing("AADHAAR_FRONT")).toBe("back");
  });
  it("offers the torch for documents only", () => {
    expect(torchAvailable("SELFIE")).toBe(false);
    expect(torchAvailable("AADHAAR_BACK")).toBe(true);
  });
  it("names the screen and the hint per kind", () => {
    expect(captureTitleKey("AADHAAR_FRONT")).toBe("kyc.doc.AADHAAR_FRONT");
    expect(captureHintKey("SELFIE")).toBe("kyc.selfieHint");
    expect(captureHintKey("PAN")).toBe("kyc.cardHint");
  });
});

describe("permissionView", () => {
  it("waits while the permission is still being read", () => {
    expect(permissionView(null)).toBe("loading");
  });
  it("opens the camera once granted", () => {
    expect(permissionView({ granted: true, canAskAgain: true })).toBe("ready");
    expect(permissionView({ granted: true, canAskAgain: false })).toBe("ready");
  });
  it("asks while the system dialog can still show, and sends the user to Settings after a permanent denial", () => {
    expect(permissionView({ granted: false, canAskAgain: true })).toBe("ask");
    expect(permissionView({ granted: false, canAskAgain: false })).toBe("settings");
  });
});

describe("guideBox", () => {
  const area = { width: 400, height: 800 };
  it("is a card at 1.586 with 28 on each side, its centre 40% down the area (as on the board)", () => {
    const box = guideBox("PAN", area);
    expect(box.x).toBe(28);
    expect(box.width).toBe(344);
    expect(box.height).toBeCloseTo(344 / 1.586, 5);
    expect(box.y).toBeCloseTo(320 - box.height / 2, 5);
    expect(box.radius).toBe(14);
    expect(box.shape).toBe("card");
  });
  it("is a 220x290 oval for the selfie, centred across and 40% down", () => {
    expect(guideBox("SELFIE", area)).toEqual({ x: 90, y: 175, width: 220, height: 290, radius: 145, shape: "oval" });
  });
  it("never leaves the area, on a narrow one or a short one", () => {
    const box = guideBox("SELFIE", { width: 200, height: 250 });
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(200);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(250);
    const card = guideBox("PAN", { width: 400, height: 200 });
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.y + card.height).toBeLessThanOrEqual(200);
  });
});

describe("scrimRects", () => {
  it("covers everything outside the guide with four rects that do not overlap the hole", () => {
    const area = { width: 400, height: 800 };
    const box = { x: 28, y: 300, width: 344, height: 200, radius: 14, shape: "card" as const };
    const rects = scrimRects(box, area);
    expect(rects).toEqual([
      { x: 0, y: 0, width: 400, height: 300 },
      { x: 0, y: 500, width: 400, height: 300 },
      { x: 0, y: 300, width: 28, height: 200 },
      { x: 372, y: 300, width: 28, height: 200 },
    ]);
    const covered = rects.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(covered + box.width * box.height).toBe(400 * 800);
  });
});

describe("cameraMounted", () => {
  it("mounts only with permission, on a focused screen, with no photo being previewed", () => {
    expect(cameraMounted({ view: "ready", focused: true, hasShot: false })).toBe(true);
    expect(cameraMounted({ view: "ready", focused: false, hasShot: false })).toBe(false);
    expect(cameraMounted({ view: "ready", focused: true, hasShot: true })).toBe(false);
    for (const view of ["loading", "ask", "settings"] as const) expect(cameraMounted({ view, focused: true, hasShot: false })).toBe(false);
  });
});

describe("shutterEnabled", () => {
  it("needs a mounted camera that reported ready, and no capture in progress", () => {
    expect(shutterEnabled({ mounted: true, ready: true, capturing: false })).toBe(true);
    expect(shutterEnabled({ mounted: true, ready: false, capturing: false })).toBe(false);
    expect(shutterEnabled({ mounted: true, ready: true, capturing: true })).toBe(false);
  });
  it("is off when the camera is not mounted, even if an earlier mount had reported ready", () => {
    expect(shutterEnabled({ mounted: false, ready: true, capturing: false })).toBe(false);
  });
});
