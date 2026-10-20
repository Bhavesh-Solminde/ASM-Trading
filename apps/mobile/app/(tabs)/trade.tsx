import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChartToolbar } from "@/trade/ChartToolbar";
import { useFullscreen } from "@/trade/fullscreen-store";
import { TradingSkeleton } from "@/trade/TradingSkeleton";
import { bootstrapRequestedAt, useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { loadLastUserId, loadResume, saveLastNickname, saveLastUserId } from "@/cache/resume-cache";
import { useSocket } from "@/socket/socket-store";
import { color, space } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { AppHeader } from "@/ui/AppHeader";
import { BrandMark } from "@/ui/Brand";
import { accountOfType, bootstrapTradesAccountId, canUseLive, resolveAccount, staleBalance, type AppAccount } from "@/trade/accounts";
import { ChartTools } from "@/trade/ChartTools";
import { Dock } from "@/trade/Dock";
import { findAsset, precisionFor, resolveSymbol, toggleFavourite } from "@/trade/markets";
import { useListLoaded } from "@/trade/list-loaded-store";
import { hasOpenTrade } from "@/trade/open-trades";
import { MarketPill } from "@/trade/MarketPill";
import { PositionStrip } from "@/trade/PositionStrip";
import { useResultFeedback } from "@/trade/ResultToast";
import { SentimentBar } from "@/trade/SentimentBar";
import { StatusLine } from "@/trade/StatusRow";
import { StaleTopBar, TopBar } from "@/trade/TopBar";
import { TradeChart } from "@/trade/TradeChart";
import { useUserPrefs } from "@/trade/trade-prefs";
import { useKeepAwakeWhileOpen } from "@/trade/useKeepAwakeWhileOpen";
import { useAccountTradesLoaded } from "@/trade/useAccountTrades";
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
      accessibilityLiveRegion="polite"
      style={
        compact
          ? { flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(3), minHeight: 52 }
          : { flex: 1, alignItems: "center", justifyContent: "center", gap: space(4), padding: space(6) }
      }
    >
      <Txt color={color.ink2} style={{ flex: compact ? 1 : undefined, textAlign: compact ? "left" : "center" }}>
        {t("common.genericError")}
      </Txt>
      <View style={compact ? undefined : { alignSelf: "stretch" }}>
        <Button kind="secondary" label={t("common.retry")} onPress={onRetry} />
      </View>
    </View>
  );
}

export default function Trade() {
  const fullscreen = useFullscreen(s => s.active);
  const insets = useSafeAreaInsets();
  useFocusEffect(useCallback(() => {
    if (!fullscreen) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => { useFullscreen.getState().set(false); return true; });
    return () => back.remove();
  }, [fullscreen]));
  useEffect(() => () => useFullscreen.getState().set(false), []);
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

  // Any account's open trade counts: its settlement is watched (the keep-awake hook reads the store itself).
  const hasOpenTrades = useSocket((s) => hasOpenTrade(s.trades.tradesByAccount));
  useKeepAwakeWhileOpen();
  useSettlementWatchdog(hasOpenTrades);
  // One fetch of the selected account's trade list (bootstrap carries only the default account's), shared by the
  // top bar's "today" line and the trades sheet's day total: both hide until it has loaded.
  const listLoaded = useAccountTradesLoaded(account?.id ?? "", !!boot && !!account && account.id !== bootstrapTradesAccountId(boot.accounts));
  // Publish which account's list is complete, so the other tabs (History) read it instead of fetching.
  const publishListLoaded = useListLoaded((s) => s.set);
  const listLoadedAccountId = account && listLoaded ? account.id : null;
  useEffect(() => {
    publishListLoaded(listLoadedAccountId);
  }, [listLoadedAccountId, publishListLoaded]);
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

  // The lock screen greets by this nickname (never the email). Only a loaded bootstrap may write it; null clears it.
  const nickname = boot?.profile.nickname ?? null;
  const booted = boot !== undefined;
  useEffect(() => {
    if (booted) saveLastNickname(nickname);
  }, [booted, nickname]);

  // Subscribe on the market/timeframe only: a bootstrap refetch must not reset the chart.
  useEffect(() => {
    if (symbol) useSocket.getState().subscribe(symbol, timeframe);
  }, [symbol, timeframe]);

  useResumeSave(boot?.userId ?? null, accountId, symbol, timeframe, asset ? asset.precision : null, account ? { type: account.type, currency: account.currency } : null);

  // The snapshot is only ever painted (and labelled stale) until live candles first arrive this mount.
  const liveArrived = useLiveArrived();
  const candleSnapshot = liveArrived ? null : resume;

  const selectAccountType = (type: AppAccount["type"]) => {
    const target = boot ? accountOfType(boot.accounts, type) : undefined;
    if (target) prefs.set({ accountId: target.id });
  };
  const pickSymbol = (next: string) => prefs.set({ symbol: next });
  const toggleStar = (next: string) => prefs.set({ favourites: toggleFavourite(prefs.favourites, next) });
  const setChartType = (chartType: ChartType) => prefs.set({ chartType });
  const setTimeframe = (next: Timeframe) => prefs.set({ timeframe: next });

  // Until bootstrap arrives the cached balance (dimmed) beats a skeleton; without one, the skeleton stays.
  // A balance the store already holds for the saved account (socket push, HTTP open result) beats the cached one.
  const storedBalance = useSocket((s) => (resume ? s.trades.balances[resume.accountId] : undefined));
  const stale = !boot && !bootFailed ? staleBalance(resume, storedBalance) : null;

  return (
    <Screen bleedTop style={{ paddingBottom: fullscreen ? insets.bottom : 0 }}>
      {boot && account ? (
        <TopBar
          account={account}
          liveEnabled={canUseLive(boot.accounts, boot.liveAccess)}
          onSelectType={selectAccountType}
        />
      ) : !bootFailed && stale ? (
        <StaleTopBar totalMinor={stale.totalMinor} type={stale.type} currency={stale.currency} live={stale.live} />
      ) : (
        <AppHeader>
          <BrandMark width={34} />
          <View style={{ flex: 1 }} />
          {bootFailed ? null : <Skeleton height={20} width={120} />}
        </AppHeader>
      )}
      {/* With a resume cache the chart is still showing, so the error is a strip; without one, see below. */}
      {!boot && bootFailed && symbol ? <BootError compact onRetry={retry} /> : null}
      {boot ? <ChartTools chartType={prefs.chartType} timeframe={timeframe} onChartType={setChartType} onTimeframe={setTimeframe} leading={<MarketPill assets={boot.assets} asset={asset} favourites={prefs.favourites} onPick={pickSymbol} onToggleFavourite={toggleStar} />} /> : null}
      <View style={{ flex: 1, minHeight: 100 }}>
        {symbol ? (
          <TradeChart
            symbol={symbol}
            timeframe={timeframe}
            type={prefs.chartType}
            precision={precisionFor(asset, resume?.symbol === symbol ? resume.precision : undefined)}
            accountId={accountId}
            snapshot={candleSnapshot}
            tradesSnapshot={boot ? null : resume}
            topInset={8}
            hideReadout={false}
          />
        ) : bootFailed ? (
          <BootError onRetry={retry} />
        ) : <TradingSkeleton />}
        <SentimentBar />
        <View pointerEvents="none" style={{ position: "absolute", left: 12, bottom: 8, right: 120 }}>
          <StatusLine snapshot={candleSnapshot} symbol={symbol} timeframe={timeframe} />
        </View>
        {boot && account ? <View pointerEvents="box-none" style={{ position: "absolute", bottom: 24, left: 0, right: 0 }}><PositionStrip accountId={account.id} accountType={account.type} assets={boot.assets} currency={account.currency} listLoaded={listLoaded} /></View> : null}
      </View>
      {boot && account ? <ChartToolbar timeframe={timeframe} onTimeframe={setTimeframe} accountId={account.id} accountType={account.type} assets={boot.assets} currency={account.currency} listLoaded={listLoaded} /> : null}
      {boot && accountId && asset ? <Dock boot={boot} accountId={accountId} asset={asset} /> : null}
    </Screen>
  );
}
