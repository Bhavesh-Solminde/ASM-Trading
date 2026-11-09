import { useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import { soonestOpen } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import type { SheetRef } from "@/ui/Sheet";
import type { AppAsset } from "./markets";
import { OpenPositionCard } from "./OpenPositionCard";
import { TradeDetailSheet } from "./TradeDetailSheet";
const NO_TRADES: readonly TradeView[] = [];
/** The soonest open position overlays the chart; its detail sheet survives settlement. */
export function PositionStrip({
  accountId,
  accountType,
  assets,
  currency,
}: {
  accountId: string;
  accountType: "DEMO" | "LIVE";
  assets: readonly AppAsset[];
  currency: string;
  /** Whether this account's trade list is known complete (`useAccountTradesLoaded`); the sheet hides today's total until then. */
  listLoaded: boolean;
}) {
  const trades = useSocket((s) => s.trades.tradesByAccount[accountId]) ?? NO_TRADES;
  const soonest = useMemo(() => soonestOpen(trades), [trades]);
  const sheet = useRef<SheetRef>(null);
  const openSheet = useCallback(() => sheet.current?.present(), []);
  const asset = soonest ? assets.find((a) => a.symbol === soonest.trade.symbol) : undefined;
  return (
    <>
      {soonest ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
          <OpenPositionCard
            key={soonest.trade.id}
            trade={soonest.trade}
            more={soonest.more}
            name={asset?.displayName ?? soonest.trade.symbol}
            precision={asset?.precision ?? 5}
            currency={currency}
            onOpen={openSheet}
          />
        </View>
      ) : null}
      <TradeDetailSheet ref={sheet} accountId={accountId} trade={soonest?.trade ?? null} accountType={accountType} assets={assets} currency={currency} />
    </>
  );
}
