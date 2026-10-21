import { describe, expect, it } from "vitest";
import { buttonPlan, orderUpiApps, PROBE, upiAppName, upiAppUrl, UPI_APPS } from "./upi-apps";

const uri = "upi://pay?pa=collect%40ybl&pn=IndianxTrade&am=1000.37&cu=INR&tn=IXT-12345678";
const query = uri.split("?")[1];

describe("upiAppUrl", () => {
  it("keeps the server's query unchanged for each app scheme", () => {
    expect(upiAppUrl("phonepe", uri)).toBe(`phonepe://pay?${query}`);
    expect(upiAppUrl("gpay", uri)).toBe(`tez://upi/pay?${query}`);
    expect(upiAppUrl("paytm", uri)).toBe(`paytmmp://pay?${query}`);
  });

  it("hands the server's own link to the system chooser for any app", () => {
    expect(upiAppUrl("any", uri)).toBe(uri);
  });

  it("never carries the amount through anything but the server's own query (the paise identify the payment)", () => {
    expect(upiAppUrl("phonepe", uri)).toContain("am=1000.37");
  });

  it("falls back to the server's link rather than guessing when it has no query or is not a upi:// link", () => {
    expect(upiAppUrl("phonepe", "upi://pay")).toBe("upi://pay");
    expect(upiAppUrl("gpay", "https://example.com/pay?am=5")).toBe("https://example.com/pay?am=5");
    expect(upiAppUrl("paytm", "")).toBe("");
  });
});

describe("PROBE", () => {
  it("has one probe link per named app, none for the chooser", () => {
    expect(Object.keys(PROBE).sort()).toEqual(["gpay", "paytm", "phonepe"]);
  });
});

describe("orderUpiApps", () => {
  it("puts the app the user picked first and the generic chooser last", () => {
    expect(orderUpiApps(["paytm", "phonepe", "gpay"], "Gpay")).toEqual(["gpay", "paytm", "phonepe", "any"]);
  });

  it("matches the method name whatever its case", () => {
    expect(orderUpiApps(["paytm", "phonepe"], "paytm")).toEqual(["paytm", "phonepe", "any"]);
    expect(orderUpiApps(["paytm", "phonepe"], "PayTM")).toEqual(["paytm", "phonepe", "any"]);
  });

  it("still offers the generic chooser when no known app is installed", () => {
    expect(orderUpiApps([], "UPI")).toEqual(["any"]);
  });

  it("keeps the installed order when the method names no app (Any UPI app) or its app is not installed", () => {
    expect(orderUpiApps(["paytm", "gpay"], "UPI")).toEqual(["paytm", "gpay", "any"]);
    expect(orderUpiApps(["paytm", "gpay"], "PhonePe")).toEqual(["paytm", "gpay", "any"]);
  });

  it("lists each app once, ignoring a stray chooser in the input", () => {
    expect(orderUpiApps(["gpay", "gpay", "any", "paytm"], "UPI")).toEqual(["gpay", "paytm", "any"]);
  });

  it("drops a blocked app, even the one the user picked, and keeps the chooser", () => {
    expect(orderUpiApps(["phonepe", "gpay", "paytm"], "PhonePe", ["phonepe"])).toEqual(["gpay", "paytm", "any"]);
    expect(orderUpiApps(["phonepe"], "PhonePe", ["phonepe"])).toEqual(["any"]);
  });

  it("ignores blocklist names it does not know and never blocks the chooser", () => {
    expect(orderUpiApps(["gpay"], "UPI", ["bhim", "any"])).toEqual(["gpay", "any"]);
  });

  it("does not change what it was given", () => {
    const installed: ("gpay" | "paytm")[] = ["paytm", "gpay"];
    orderUpiApps(installed, "Gpay", ["paytm"]);
    expect(installed).toEqual(["paytm", "gpay"]);
  });
});

describe("buttonPlan", () => {
  it("makes the first app the big button and lists the rest", () => {
    expect(buttonPlan(["phonepe", "gpay", "any"])).toEqual({ primary: "phonepe", rest: ["gpay", "any"] });
  });
  it("is just the chooser when nothing else is installed", () => {
    expect(buttonPlan(["any"])).toEqual({ primary: "any", rest: [] });
  });
  it("falls back to the chooser for an empty list", () => {
    expect(buttonPlan([])).toEqual({ primary: "any", rest: [] });
  });
});

describe("upiAppName", () => {
  it("names the brands, and has no name for the chooser (its label is translated)", () => {
    expect(upiAppName("phonepe")).toBe("PhonePe");
    expect(upiAppName("gpay")).toBe("Google Pay");
    expect(upiAppName("paytm")).toBe("Paytm");
    expect(upiAppName("any")).toBeNull();
  });
  it("covers every app", () => {
    for (const app of UPI_APPS) expect(app === "any" || upiAppName(app) !== null).toBe(true);
  });
});
