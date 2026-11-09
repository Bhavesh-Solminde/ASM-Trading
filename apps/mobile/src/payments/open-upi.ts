import { PROBE, upiAppUrl, type NamedUpiApp, type UpiApp } from "./upi-apps";

const NAMED: NamedUpiApp[] = ["phonepe", "gpay", "paytm"];

/** Which named UPI apps this phone can open (Android 11+ needs `with-upi-queries` for the answer to be true). Never throws. */
export async function detectInstalledUpiApps(canOpen: (url: string) => Promise<boolean>): Promise<NamedUpiApp[]> {
  const answers = await Promise.all(NAMED.map((app) => canOpen(PROBE[app]).catch(() => false)));
  return NAMED.filter((_, i) => answers[i]);
}

/**
 * Hand the payment to `app`. A phone with no app for the link rejects the open: that is a toast, not a crash, and the
 * QR code and the copied UPI ID are still on the screen. Resolves true when the hand-off was made.
 */
export async function openUpiApp(
  app: UpiApp,
  upiUri: string | null,
  deps: { openURL: (url: string) => Promise<unknown>; toast: (message: string, tone: "down") => void; t: (key: string) => string },
): Promise<boolean> {
  try {
    if (!upiUri) throw new Error("no upi link");
    await deps.openURL(upiAppUrl(app, upiUri));
    return true;
  } catch {
    deps.toast(deps.t("pay.noApp"), "down");
    return false;
  }
}
