import { OpenTradeSchema, type Bootstrap } from "@asm/contracts";
import { convertMinorBetween } from "@asm/client-core";
import { ApiError, GENERIC_ERROR } from "@/api/errors";

/** The currencies an account can be converted between: the contract's own enum (the server accepts exactly these). */
export const SWITCH_CURRENCIES = OpenTradeSchema.shape.currency.unwrap().options;
export type SwitchCurrency = (typeof SWITCH_CURRENCIES)[number];

/** A switch that gets no answer by then is given up on; the server may still have done it (see `api` `timeoutMs`). */
export const CURRENCY_SWITCH_TIMEOUT_MS = 15_000;

/** The currency a switch from `currency` would land on, or null when `currency` is not one of the two. */
export function otherCurrency(currency: string): SwitchCurrency | null {
  const index = SWITCH_CURRENCIES.findIndex((c) => c === currency);
  if (index < 0) return null;
  return SWITCH_CURRENCIES[(index + 1) % SWITCH_CURRENCIES.length] ?? null;
}

type AccountLike = Pick<Bootstrap["accounts"][number], "id" | "type" | "currency" | "realBalance" | "bonusBalance">;

export interface CurrencyRow {
  accountId: string;
  type: "DEMO" | "LIVE";
  currency: string;
  /** Real + bonus, in `currency`'s minor units: the server converts the whole balance. */
  totalMinor: number;
  next: SwitchCurrency;
  /** The balance converted at the fixed rate, in `next`'s minor units: real and bonus rounded separately, as the server does. */
  previewMinor: number;
}

/**
 * One row per account, Demo first then Live. `balances` is the socket's latest balance per account id: it moves with
 * every trade and beats the bootstrap's. An account in a currency that cannot be switched has no row.
 */
export function currencyRows(
  accounts: readonly AccountLike[] | undefined,
  balances: Readonly<Record<string, { realBalance: number; bonusBalance: number } | undefined>> = {},
): CurrencyRow[] {
  const rows: CurrencyRow[] = [];
  for (const type of ["DEMO", "LIVE"] as const) {
    const account = accounts?.find((a) => a.type === type);
    if (!account) continue;
    const next = otherCurrency(account.currency);
    if (!next) continue;
    const live = balances[account.id] ?? account;
    const totalMinor = live.realBalance + live.bonusBalance;
    rows.push({
      accountId: account.id,
      type,
      currency: account.currency,
      totalMinor,
      next,
      previewMinor:
        convertMinorBetween(live.realBalance, account.currency, next) + convertMinorBetween(live.bonusBalance, account.currency, next),
    });
  }
  return rows;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Toast = (message: string, tone: "up" | "down") => void;

/** Errors something else already reports: a rate limit toasts, a gate screen replaces the app, `unauthenticated` signs out. */
const HANDLED_ELSEWHERE = new Set(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]);

/**
 * The text to toast for a failed switch. offline and timeout read as "check your balance" (the request may have
 * landed); another 4xx (the server refuses a switch with a 409) shows the server's own message; 5xx and a bare error
 * are generic.
 */
export function currencySwitchErrorText(e: unknown, t: Translate): string {
  if (e instanceof ApiError) {
    if (e.code === "offline" || e.code === "timeout") return t("currency.timedOut");
    if (e.status >= 400 && e.status < 500 && e.message !== GENERIC_ERROR && e.message.trim() !== "") return e.message;
  }
  return t("common.genericError");
}

export interface CurrencySwitchDeps {
  /** POST `/api/account/currency { accountId, currency }` with the timeout above; never retried. */
  post: (accountId: string, currency: SwitchCurrency) => Promise<unknown>;
  /** `invalidateMoney`: wallet, payments, ledger and the bootstrap, whose balances and currencies every screen reads. */
  refresh: () => void;
  /** Refetch that account's trade list: the server converts its trades' amounts in place, and only Demo's ride the bootstrap. */
  refetchTrades: (accountId: string) => void;
  toast: Toast;
  /** Identifies the signed-in session (its token); a result that arrives under a different one is dropped. */
  session: () => string | null;
  /** The id of the account being switched, or null when idle. */
  setBusy: (accountId: string | null) => void;
  t: Translate;
}

/**
 * The currency switch, a money-moving POST under the P3 rules, free of React and native modules: one at a time (a plain
 * variable, so two taps in one frame cannot both pass), a timeout set by the caller's `post`, and never retried. After
 * a timeout it refreshes anyway (the switch may have landed) and says to look before trying again.
 */
export function createCurrencySwitcher(deps: CurrencySwitchDeps): (accountId: string, currency: SwitchCurrency) => Promise<void> {
  let inFlight = false;
  return async (accountId, currency) => {
    if (inFlight) return;
    inFlight = true;
    deps.setBusy(accountId);
    const session = deps.session();
    try {
      await deps.post(accountId, currency);
      if (deps.session() !== session) return;
      deps.refresh();
      deps.refetchTrades(accountId);
      deps.toast(deps.t("currency.done", { currency }), "up");
    } catch (e) {
      if (deps.session() !== session) return;
      if (e instanceof ApiError && e.code !== null && HANDLED_ELSEWHERE.has(e.code)) return;
      if (e instanceof ApiError && (e.code === "timeout" || e.code === "offline")) {
        deps.refresh();
        deps.refetchTrades(accountId);
      }
      deps.toast(currencySwitchErrorText(e, deps.t), "down");
    } finally {
      inFlight = false;
      deps.setBusy(null);
    }
  };
}
