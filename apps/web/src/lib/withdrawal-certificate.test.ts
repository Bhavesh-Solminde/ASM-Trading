import { describe, expect, it } from "vitest";
import { nameFontSize, renderCertificateJpeg } from "./withdrawal-certificate";

describe("withdrawal certificate image", () => {
  it("keeps the design's 35px name size for a typical name", () => {
    expect(nameFontSize("SAKSHI BHAGAT")).toBe(35);
  });

  it("shrinks a long name so it stays clear of the person icon", () => {
    const size = nameFontSize("VENKATA SUBRAMANIAN RAGHUNATHAN IYER");
    expect(size).toBeLessThan(35);
    expect(size).toBeGreaterThanOrEqual(18);
  });

  it("renders a JPEG at the artwork's full size", async () => {
    const jpg = await renderCertificateJpeg({ name: "Asha Rao", amountLabel: "₹2,500.00", dateLabel: "29/10/2026", refId: "8F3A21C9" });
    expect(jpg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    // SOF0/SOF2 frame header carries height then width.
    const sof = jpg.findIndex((b, i) => b === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2));
    expect([jpg.readUInt16BE(sof + 5), jpg.readUInt16BE(sof + 7)]).toEqual([1024, 1536]);
    expect(jpg.length).toBeLessThan(400_000);
  });
});
