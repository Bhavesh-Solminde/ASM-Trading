import { useRef, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { invalidateMoney } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { money } from "@/money/format";
import { fetchAccountTrades } from "@/trade/fetch-account-trades";
import { toast } from "@/ui/Toast";
import { CURRENCY_SWITCH_TIMEOUT_MS, createCurrencySwitcher, type CurrencyRow } from "./currency-switch";

/**
 * "Switch to USD / INR": the confirm Alert (it shows what the balance becomes), then the money-moving POST (see
 * `createCurrencySwitcher`). `busyId` is the account being switched, or null.
 */
export function useCurrencySwitch() {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Built once: its in-flight flag must survive re-renders. It reads the latest `t` from here.
  const latestT = useRef(t);
  latestT.current = t;
  const submitter = useRef<ReturnType<typeof createCurrencySwitcher> | null>(null);
  if (submitter.current === null) {
    submitter.current = createCurrencySwitcher({
      post: (accountId, currency) => api("/api/account/currency", { method: "POST", body: { accountId, currency }, timeoutMs: CURRENCY_SWITCH_TIMEOUT_MS }),
      refresh: invalidateMoney,
      refetchTrades: (accountId) => void fetchAccountTrades(accountId).catch(() => {}),
      toast,
      session: () => useSession.getState().token,
      setBusy: setBusyId,
      t: (key, options) => latestT.current(key, options),
    });
  }

  const confirmSwitch = (row: CurrencyRow) => {
    const from = money(row.totalMinor, row.currency);
    const to = money(row.previewMinor, row.next);
    Alert.alert(t("currency.confirmTitle", { currency: row.next }), t("currency.confirmBody", { from, to }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("currency.switchTo", { currency: row.next }), onPress: () => void submitter.current?.(row.accountId, row.next) },
    ]);
  };

  return { busyId, confirmSwitch };
}
