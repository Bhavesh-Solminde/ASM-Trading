import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { bootstrapRequestedAt, useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { loadLastUserId, loadResume, saveLastUserId } from "@/cache/resume-cache";
import { useSocket } from "@/socket/socket-store";
import { color, space } from "@/theme/tokens";
import { Button, Screen, Skeleton } from "@/theme/ui";
import type { SheetRef } from "@/ui/Sheet";
import { accountOfType, canUseLive, resolveAccount, type AppAccount } from "@/trade/accounts";
import { BonusSheet } from "@/trade/BonusSheet";
import { ChartTools } from "@/trade/ChartTools";
import { Dock } from "@/trade/Dock";
import { findAsset, nextBonus, precisionFor, resolveSymbol, toggleFavourite } from "@/trade/markets";
import { hasOpenTrade } from "@/trade/open-trades";
import { MarketPill } from "@/trade/MarketPill";
import { PositionStrip } from "@/trade/PositionStrip";
import { useResultFeedback } from "@/trade/ResultToast";
import { SentimentBar } from "@/trade/SentimentBar";
import { StatusRow } from "@/trade/StatusRow";
import { TopBar } from "@/trade/TopBar";
import { TradeChart } from "@/trade/TradeChart";
import { useUserPrefs } from "@/trade/trade-prefs";
import { useKeepAwakeWhileOpen } from "@/trade/useKeepAwakeWhileOpen";
import { useLiveArrived } from "@/trade/useLiveArrived";
import { useResumeSave } from "@/trade/useResumeSave";
import { useSettlementWatchdog } from "@/trade/useSettlementWatchdog";
import type { ChartType } from "@/chart/types";
import type { Timeframe } from "@asm/contracts";

/** Bootstrap failed and there is nothing else to show: say so and offer a retry instead of a skeleton forever. */
function BootError({ onRetry, compact }: { onRetry: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <View
      accessibilityRole="alert"
      style={
        compact
          ? { flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(3), minHeight: 52 }
          : { flex: 1, alignItems: "center", justifyContent: "center", gap: space(4), padding: space(6) }
      }
    >
      <Text style={{ color: color.ink2, fontSize: 14, flex: compact ? 1 : undefined, textAlign: compact ? "left" : "center" }}>
        {t("common.genericError")}
      </Text>
      <View style={compact ? undefined : { alignSelf: "stretch" }}>
        <Button kind="secondary" label={t("common.retry")} onPress={onRetry} />
      </View>
    </View>
  );
}

export default function Trade() {
  const token = useSession((s) => s.token);
  const bootQuery = useBootstrap(!!token);
  const boot = bootQuery.data;
  const bootFailed = !boot && bootQuery.isError;
  const { refetch } = bootQuery;
  const retry = useCallback(() => void refetch(), [refetch]);

  // Read the resume cache ONCE: it is a synchronous disk read + parse. It lets the chart paint before
  // bootstrap returns; it is stale until live data replaces it, and ignored if bootstrap names another user.
  const [initial] = useState(() => {
    const lastUserId = loadLastUserId();
    return { lastUserId, resume: lastUserId ? loadResume(lastUserId) : null };
  });
  const resume = initial.resume && (!boot || boot.userId === initial.resume.snapshot.userId) ? initial.resume.snapshot : null;

  // Prefs are per user, so the user must be known before bootstrap too (from the remembered last user).
  const userId = boot?.userId ?? initial.lastUserId;
  const prefs = useUserPrefs(userId);

  const account: AppAccount | undefined = boot ? resolveAccount(boot.accounts, prefs.accountId, boot.liveAccess) : undefined;
  const accountId = account?.id ?? resume?.accountId ?? null;
  const symbol = boot ? resolveSymbol(boot.assets, prefs.symbol ?? resume?.symbol ?? null, boot.defaultSymbol) : (prefs.symbol ?? resume?.symbol ?? null);
  const timeframe = prefs.timeframe;
  const asset = boot ? findAsset(boot.assets, symbol) : undefined;

  // Any account's open trade counts: it still needs its settlement watched and the screen awake.
  const hasOpenTrades = useSocket((s) => hasOpenTrade(s.trades.tradesByAccount));
  useKeepAwakeWhileOpen();
  useSettlementWatchdog(hasOpenTrades);
  useResultFeedback(account?.id ?? null, account?.currency ?? null, boot?.assets);

  // Every successful bootstrap fetch (first load, post-deposit invalidation, foreground, watchdog and reconnect
  // refetches) is merged into the store; the merge never rolls back anything the socket delivered since the
  // request started. Keyed on `dataUpdatedAt`, not just `boot`: React Query keeps the old object when a refetch
  // returns structurally identical data, and a reconnect refetch must still get its merge.
  const bootUpdatedAt = bootQuery.dataUpdatedAt;
  useEffect(() => {
    if (boot) useSocket.getState().seed(boot, bootstrapRequestedAt());
  }, [boot, bootUpdatedAt]);

  useEffect(() => {
    if (boot?.userId) saveLastUserId(boot.userId);
  }, [boot?.userId]);

  // Subscribe on the market/timeframe only: a bootstrap refetch must not reset the chart.
  useEffect(() => {
    if (symbol) useSocket.getState().subscribe(symbol, timeframe);
  }, [symbol, timeframe]);

  useResumeSave(boot?.userId ?? null, accountId, symbol, timeframe, asset ? asset.precision : null);

  // The snapshot is only ever painted (and labelled stale) until live candles first arrive this mount.
  const liveArrived = useLiveArrived();
  const candleSnapshot = liveArrived ? null : resume;

  const bonusSheet = useRef<SheetRef>(null);
  const openBonus = useCallback(() => bonusSheet.current?.present(), []);

  const selectAccountType = (type: AppAccount["type"]) => {
    const target = boot ? accountOfType(boot.accounts, type) : undefined;
    if (target) prefs.set({ accountId: target.id });
  };
  const pickSymbol = (next: string) => prefs.set({ symbol: next });
  const toggleStar = (next: string) => prefs.set({ favourites: toggleFavourite(prefs.favourites, next) });
  const setChartType = (chartType: ChartType) => prefs.set({ chartType });
  const setTimeframe = (next: Timeframe) => prefs.set({ timeframe: next });

  const bonus = boot ? nextBonus(boot.completedDeposits) : null;

  return (
    <Screen>
      {boot && account ? (
        <TopBar account={account} liveEnabled={canUseLive(boot.accounts, boot.liveAccess)} onSelectType={selectAccountType} />
      ) : bootFailed ? (
        // With a resume cache the chart is still showing, so the error is a strip; without one, see below.
        symbol ? <BootError compact onRetry={retry} /> : null
      ) : (
        <View style={{ height: 52, justifyContent: "center", paddingHorizontal: 12 }}>
          <Skeleton height={28} />
        </View>
      )}
      <StatusRow bonusPct={bonus?.pct ?? null} snapshot={candleSnapshot} symbol={symbol} timeframe={timeframe} onBonus={openBonus} />
      <View style={{ flex: 1 }}>
        {symbol ? (
          <TradeChart
            symbol={symbol}
            timeframe={timeframe}
            type={prefs.chartType}
            precision={precisionFor(asset, resume?.symbol === symbol ? resume.precision : undefined)}
            accountId={accountId}
            snapshot={candleSnapshot}
            tradesSnapshot={boot ? null : resume}
          />
        ) : bootFailed ? (
          <BootError onRetry={retry} />
        ) : null}
        <SentimentBar />
        {boot ? (
          <View pointerEvents="box-none" style={{ position: "absolute", top: 8, left: 8, right: 8 }}>
            <ChartTools
              chartType={prefs.chartType}
              timeframe={timeframe}
              onChartType={setChartType}
              onTimeframe={setTimeframe}
              leading={
                <MarketPill assets={boot.assets} asset={asset} favourites={prefs.favourites} onPick={pickSymbol} onToggleFavourite={toggleStar} />
              }
            />
          </View>
        ) : null}
      </View>
      {boot && account ? <PositionStrip accountId={account.id} assets={boot.assets} currency={account.currency} /> : null}
      {boot && accountId && asset ? <Dock boot={boot} accountId={accountId} asset={asset} /> : null}
      {boot ? <BonusSheet ref={bonusSheet} completedDeposits={boot.completedDeposits} /> : null}
    </Screen>
  );
}
