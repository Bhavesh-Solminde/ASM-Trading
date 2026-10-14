import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import type { AppAsset } from "./markets";
import { claimAnnouncement, settledFeedback } from "./result";

/**
 * Settled trades already considered, kept outside the hook so a remount of the Trade screen cannot replay the
 * store's `lastSettled`. Same lifetime as that store value.
 */
const seen = new Set<string>();

/**
 * Toast + haptic when a trade on the SELECTED account settles (the web app does the same and ignores other
 * accounts). Only settlements pushed over the socket count: `lastSettled` is set by `trade:settled` alone, so a
 * trade that settled while the app was backgrounded and later arrived with a bootstrap refetch is shown in the
 * trades sheet but never announced. See `claimAnnouncement` for the freshness and once-only rules.
 */
export function useResultFeedback(accountId: string | null, currency: string | null, assets: readonly AppAsset[] | undefined): void {
  const { t } = useTranslation();
  const last = useSocket((s) => s.lastSettled);
  useEffect(() => {
    if (!last || accountId === null || currency === null) return;
    if (!claimAnnouncement(seen, last, { accountId, nowSec: Math.floor(Date.now() / 1000) })) return;
    const f = settledFeedback(last, currency);
    const name = assets?.find((a) => a.symbol === last.symbol)?.displayName ?? last.symbol;
    toast(`${name} · ${t(f.key, { amount: f.amountText })}`, f.tone);
    if (f.haptic === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (f.haptic === "warning") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [last, accountId, currency, assets, t]);
}
