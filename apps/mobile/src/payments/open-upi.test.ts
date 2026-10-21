import { describe, expect, it, vi } from "vitest";
import { detectInstalledUpiApps, openUpiApp } from "./open-upi";

const uri = "upi://pay?pa=collect%40ybl&am=1000.37&cu=INR&tn=IXT-12345678";
const t = (key: string) => `t:${key}`;

describe("detectInstalledUpiApps", () => {
  it("lists the named apps whose link can be opened, in a fixed order", async () => {
    const canOpen = vi.fn(async (url: string) => url.startsWith("paytmmp") || url.startsWith("phonepe"));
    expect(await detectInstalledUpiApps(canOpen)).toEqual(["phonepe", "paytm"]);
    expect(canOpen).toHaveBeenCalledTimes(3);
  });
  it("treats a probe that throws as not installed, never failing the screen", async () => {
    const canOpen = async (url: string) => {
      if (url.startsWith("tez")) throw new Error("denied");
      return true;
    };
    expect(await detectInstalledUpiApps(canOpen)).toEqual(["phonepe", "paytm"]);
  });
  it("is empty when nothing answers", async () => {
    expect(await detectInstalledUpiApps(async () => false)).toEqual([]);
  });
});

describe("openUpiApp", () => {
  it("opens the app's link for this payment", async () => {
    const openURL = vi.fn(async () => true);
    const toast = vi.fn();
    expect(await openUpiApp("gpay", uri, { openURL, toast, t })).toBe(true);
    expect(openURL).toHaveBeenCalledWith("tez://upi/pay?pa=collect%40ybl&am=1000.37&cu=INR&tn=IXT-12345678");
    expect(toast).not.toHaveBeenCalled();
  });
  it("hands the server's own link to the system chooser for any app", async () => {
    const openURL = vi.fn(async () => true);
    await openUpiApp("any", uri, { openURL, toast: vi.fn(), t });
    expect(openURL).toHaveBeenCalledWith(uri);
  });
  it("tells the user, in their language, when no app can open it, and does not throw", async () => {
    const toast = vi.fn();
    const openURL = vi.fn(async () => {
      throw new Error("Unable to open URL");
    });
    expect(await openUpiApp("phonepe", uri, { openURL, toast, t })).toBe(false);
    expect(toast).toHaveBeenCalledWith("t:pay.noApp", "down");
  });
  it("opens nothing for a payment with no link (a USDT deposit, or a view that has none yet)", async () => {
    const openURL = vi.fn(async () => true);
    const toast = vi.fn();
    expect(await openUpiApp("any", null, { openURL, toast, t })).toBe(false);
    expect(openURL).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("t:pay.noApp", "down");
  });
});
