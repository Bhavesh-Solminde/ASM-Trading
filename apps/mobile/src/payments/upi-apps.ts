/** The UPI apps the pay screen can hand off to. `any` is the system chooser (every app that handles `upi://`). */
export const UPI_APPS = ["phonepe", "gpay", "paytm", "any"] as const;
export type UpiApp = (typeof UPI_APPS)[number];
export type NamedUpiApp = Exclude<UpiApp, "any">;

const PREFIX: Record<NamedUpiApp, string> = {
  phonepe: "phonepe://pay?",
  gpay: "tez://upi/pay?",
  paytm: "paytmmp://pay?",
};

/** The deposit method's label (`Deposit.method`) to the app it names. "UPI" names none: the user picks. */
const FOR_METHOD: Record<string, NamedUpiApp> = { phonepe: "phonepe", gpay: "gpay", paytm: "paytm" };

/** Brand names are not translated. The chooser has no brand: its label is `pay.openUpiApp` / `pay.otherApps`. */
const NAME: Record<NamedUpiApp, string> = { phonepe: "PhonePe", gpay: "Google Pay", paytm: "Paytm" };

export function upiAppName(app: UpiApp): string | null {
  return app === "any" ? null : NAME[app];
}

/**
 * The link that opens `app` on this payment. The query (payee, the exact amount whose paise identify the payment, the
 * note) is the server's, untouched. Anything that is not a `upi://` link with a query is returned as it came: the
 * system chooser (or a failure the caller reports) is better than a link built from a guess.
 */
export function upiAppUrl(app: UpiApp, upiUri: string): string {
  if (app === "any") return upiUri;
  const at = upiUri.indexOf("?");
  if (!upiUri.startsWith("upi://") || at < 0 || at === upiUri.length - 1) return upiUri;
  return `${PREFIX[app]}${upiUri.slice(at + 1)}`;
}

/** Android answers `canOpenURL` for these only once `with-upi-queries` has declared the schemes. */
export const PROBE: Record<NamedUpiApp, string> = {
  phonepe: "phonepe://pay",
  gpay: "tez://upi/pay",
  paytm: "paytmmp://pay",
};

export const isNamedApp = (value: string): value is NamedUpiApp => value === "phonepe" || value === "gpay" || value === "paytm";

/**
 * The buttons to offer, best first. The installed apps (once each, none of them blocked), with the one the deposit
 * method names in front, then the system chooser last. The blocklist is the operator's switch (`UPI_APP_BLOCKLIST`,
 * wired in T9) for an app that is rejecting payments to new merchants; the chooser is never blocked.
 */
export function orderUpiApps(installed: readonly UpiApp[], preferredMethod: string, blocklist: readonly string[] = []): UpiApp[] {
  const blocked = new Set(blocklist);
  const known = [...new Set(installed.filter(isNamedApp))].filter((app) => !blocked.has(app));
  const preferred = FOR_METHOD[preferredMethod.trim().toLowerCase()];
  const sorted = preferred && known.includes(preferred) ? [preferred, ...known.filter((app) => app !== preferred)] : known;
  return [...sorted, "any"];
}

/** The first app is the big "Open <App>" button; the rest sit in a grid below it. */
export function buttonPlan(ordered: readonly UpiApp[]): { primary: UpiApp; rest: UpiApp[] } {
  const [primary, ...rest] = ordered;
  return { primary: primary ?? "any", rest };
}
