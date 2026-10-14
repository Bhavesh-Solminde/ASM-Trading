import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { loadLastUserId, loadResume, saveLastUserId } from "@/cache/resume-cache";
import { useSocket } from "@/socket/socket-store";
import { Screen, Skeleton } from "@/theme/ui";
import type { SheetRef } from "@/ui/Sheet";
import { accountOfType, canUseLive, resolveAccount, type AppAccount } from "@/trade/accounts";
import { BonusSheet } from "@/trade/BonusSheet";
import { ChartTools } from "@/trade/ChartTools";
import { Dock } from "@/trade/Dock";
import { findAsset, nextBonus, precisionFor, resolveSymbol, toggleFavourite } from "@/trade/markets";
import { MarketPill } from "@/trade/MarketPill";
import { PositionStrip } from "@/trade/PositionStrip";
import { SentimentBar } from "@/trade/SentimentBar";
import { StatusRow } from "@/trade/StatusRow";
import { TopBar } from "@/trade/TopBar";
import { TradeChart } from "@/trade/TradeChart";
import { useUserPrefs } from "@/trade/trade-prefs";
import { useKeepAwakeWhileOpen } from "@/trade/useKeepAwakeWhileOpen";
import { useResumeSave } from "@/trade/useResumeSave";
import type { ChartType } from "@/chart/types";
import type { Timeframe } from "@asm/contracts";

export default function Trade() {
  const token = useSession((s) => s.token);
  const boot = useBootstrap(!!token).data;

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

  const hasOpenTrades = useSocket((s) => (accountId ? (s.trades.tradesByAccount[accountId] ?? []).some((t) => t.status === "OPEN") : false));
  useKeepAwakeWhileOpen(hasOpenTrades);

  // Bootstrap's trades and balances seed the store once per signed-in user; after that the socket owns them.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!boot || seededFor.current === boot.userId) return;
    seededFor.current = boot.userId;
    useSocket.getState().seed(boot);
  }, [boot]);

  useEffect(() => {
    if (boot?.userId) saveLastUserId(boot.userId);
  }, [boot?.userId]);

  // Subscribe on the market/timeframe only: a bootstrap refetch must not reset the chart.
  useEffect(() => {
    if (symbol) useSocket.getState().subscribe(symbol, timeframe);
  }, [symbol, timeframe]);

  useResumeSave(boot?.userId ?? null, accountId, symbol, timeframe);

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
      ) : (
        <View style={{ height: 52, justifyContent: "center", paddingHorizontal: 12 }}>
          <Skeleton height={28} />
        </View>
      )}
      <StatusRow bonusPct={bonus?.pct ?? null} hasCache={resume !== null} onBonus={openBonus} />
      <View style={{ flex: 1 }}>
        {symbol ? (
          <TradeChart
            symbol={symbol}
            timeframe={timeframe}
            type={prefs.chartType}
            precision={precisionFor(asset)}
            accountId={accountId}
            cached={resume}
            cachedTradesAreCurrent={boot !== undefined}
          />
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
      {boot && accountId ? <PositionStrip accountId={accountId} /> : null}
      {boot && accountId && asset ? <Dock boot={boot} accountId={accountId} asset={asset} /> : null}
      {boot ? <BonusSheet ref={bonusSheet} completedDeposits={boot.completedDeposits} /> : null}
    </Screen>
  );
}
