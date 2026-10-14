import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import type { AppAsset } from "./markets";
import { claimAnnouncement, newlySettled, settledFeedback } from "./result";

/**
 * Settled trades already considered, kept outside the hook so a remount of the Trade screen cannot announce
 * anything twice. Same lifetime as the store's settlements.
 */
const seen = new Set<string>();

/**
 * Toast + haptic when a trade on the SELECTED account settles (the web app does the same and ignores other
 * accounts). Only settlements pushed over the socket count: `lastSettled` is set by `trade:settled` alone, so a
 * trade that settled while the app was backgrounded and later arrived with a bootstrap refetch is shown in the
 * trades sheet but never announced. The store is watched imperatively (one callback per update) so two
 * settlements landing before React renders each get their toast. See `claimAnnouncement` for the once-only rules.
 */
export function useResultFeedback(accountId: string | null, currency: string | null, assets: readonly AppAsset[] | undefined): void {
  const { t } = useTranslation();
  const latest = useRef({ accountId, currency, assets, t });
  useEffect(() => {
    latest.current = { accountId, currency, assets, t };
  }, [accountId, currency, assets, t]);

  useEffect(
    () =>
      useSocket.subscribe((s, prev) => {
        const trade = newlySettled(prev.lastSettled, s.lastSettled);
        if (!trade) return;
        const { accountId: selected, currency: cur, assets: list, t: tr } = latest.current;
        // Nothing to say before the account is known; do not use up the trade's one announcement either.
        if (selected === null || cur === null) return;
        if (!claimAnnouncement(seen, trade, { accountId: selected })) return;
        const f = settledFeedback(trade, cur);
        const name = list?.find((a) => a.symbol === trade.symbol)?.displayName ?? trade.symbol;
        toast(`${name} · ${tr(f.key, { amount: f.amountText })}`, f.tone);
        if (f.haptic === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (f.haptic === "warning") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }),
    [],
  );
}
