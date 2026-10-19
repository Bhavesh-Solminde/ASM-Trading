import { forwardRef, memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { closedRowDisplay } from "@asm/client-core";
import { money } from "@/money/format";
import type { TradeView } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { color, radius, space } from "@/theme/tokens";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { closedStamp } from "./closed-stamp";
import { countdownText } from "./countdown-text";
import type { AppAsset } from "./markets";
import { useLiveTrade } from "./useLiveTrade";

const SNAP_POINTS = ["60%", "90%"];
const NO_TRADES: readonly TradeView[] = [];

type Tab = "open" | "closed";

/** Buy/Sell arrow in the trade's colour; the word next to it carries the meaning for screen readers. */
export function DirMark({ direction }: { direction: TradeView["direction"] }) {
  return (
    <Text accessible={false} style={{ color: direction === "UP" ? color.up : color.down, fontSize: 12 }}>
      {direction === "UP" ? "▲" : "▼"}
    </Text>
  );
}

function assetName(assets: readonly AppAsset[], symbol: string): string {
  return assets.find((a) => a.symbol === symbol)?.displayName ?? symbol;
}

const rowBox = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: space(3),
  minHeight: 56,
  paddingVertical: space(2),
  borderBottomWidth: 1,
  borderBottomColor: color.rule,
} as const;

function TradeName({ trade, assets, detail }: { trade: TradeView; assets: readonly AppAsset[]; detail: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
        <DirMark direction={trade.direction} />
        <Text numberOfLines={1} style={{ color: color.ink, fontSize: 15, fontWeight: "700", flexShrink: 1 }}>
          {assetName(assets, trade.symbol)}
        </Text>
        <Text style={{ color: color.ink2, fontSize: 12 }}>{trade.direction === "UP" ? t("trade.up") : t("trade.down")}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: color.ink3, fontSize: 12, fontVariant: ["tabular-nums"] }}>
        {detail}
      </Text>
    </View>
  );
}

/** Ticks on its own each second, so settled rows and the rest of the sheet never re-render for it. */
const OpenRow = memo(function OpenRow({ trade, assets, currency }: { trade: TradeView; assets: readonly AppAsset[]; currency: string }) {
  const { t } = useTranslation();
  const live = useLiveTrade(trade);
  const { pnl } = live;
  const precision = assets.find((a) => a.symbol === trade.symbol)?.precision ?? 5;
  return (
    <View style={rowBox}>
      <TradeName trade={trade} assets={assets} detail={`${money(trade.stake, currency)} · ${trade.entryPrice.toFixed(precision)}`} />
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={{ color: color.ink, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{countdownText(live, t("trade.settling"))}</Text>
        <Text
          style={{
            color: pnl === null ? color.ink2 : pnl.tone === "up" ? color.up : color.down,
            fontSize: 13,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
          }}
        >
          {pnl === null ? "—" : `${pnl.sign}${money(pnl.amountMinor, currency)}`}
        </Text>
      </View>
    </View>
  );
});

const CHIP: Record<
  Exclude<TradeView["status"], "OPEN">,
  { key: "trade.statusWon" | "trade.statusLost" | "trade.statusRefund"; bg: string; fg: string; border: string }
> = {
  WON: { key: "trade.statusWon", bg: color.up, fg: color.upInk, border: color.up },
  LOST: { key: "trade.statusLost", bg: "transparent", fg: color.down, border: color.down },
  REFUNDED: { key: "trade.statusRefund", bg: color.tile, fg: color.ink2, border: color.tile },
};

const ClosedRow = memo(function ClosedRow({ trade, assets, currency }: { trade: TradeView; assets: readonly AppAsset[]; currency: string }) {
  const { t } = useTranslation();
  const display = closedRowDisplay(trade);
  const precision = assets.find((a) => a.symbol === trade.symbol)?.precision ?? 5;
  const prices = `${trade.entryPrice.toFixed(precision)}${trade.exitPrice !== null ? ` → ${trade.exitPrice.toFixed(precision)}` : ""}`;
  // Same as the web list: a win is green, a loss is quiet rather than red, a refund is neutral.
  const amountColor = display.sign === "+" ? color.up : display.sign === "−" ? color.ink3 : color.ink2;
  const chip = trade.status === "OPEN" ? null : CHIP[trade.status];
  return (
    <View style={rowBox}>
      <TradeName trade={trade} assets={assets} detail={`${prices} · ${closedStamp(trade.expiryTs, Date.now())}`} />
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Text style={{ color: amountColor, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
          {`${display.sign}${money(display.amountMinor, currency)}`}
        </Text>
        {chip ? (
          <View style={{ backgroundColor: chip.bg, borderColor: chip.border, borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: chip.fg, fontSize: 10, fontWeight: "800" }}>{t(chip.key)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

function TabButton({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={t("trade.tabCount", { name: label, n: count })}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space(2),
        borderBottomWidth: 2,
        borderBottomColor: selected ? color.brand : "transparent",
      }}
    >
      <Text style={{ color: selected ? color.ink : color.ink2, fontSize: 14, fontWeight: "700" }}>{label}</Text>
      <View style={{ minWidth: 22, alignItems: "center", backgroundColor: color.tile, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
        <Text style={{ color: color.ink2, fontSize: 12, fontVariant: ["tabular-nums"] }}>{count}</Text>
      </View>
    </Pressable>
  );
}

/** Mounted only while the sheet is presented, so the store subscription and the row clocks exist only then. */
function TradesBody({ accountId, assets, currency }: { accountId: string; assets: readonly AppAsset[]; currency: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("open");
  // The store only ever holds live data (bootstrap + socket), never the resume snapshot's stale trades.
  const trades = useSocket((s) => s.trades.tradesByAccount[accountId]) ?? NO_TRADES;
  const { open, closed } = useMemo(
    () => ({
      open: trades.filter((x) => x.status === "OPEN").sort((a, b) => a.expiryTs - b.expiryTs),
      closed: trades.filter((x) => x.status !== "OPEN").sort((a, b) => b.expiryTs - a.expiryTs),
    }),
    [trades],
  );
  const shown = tab === "open" ? open : closed;
  return (
    <View>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: color.rule }}>
        <TabButton label={t("trade.open")} count={open.length} selected={tab === "open"} onPress={() => setTab("open")} />
        <TabButton label={t("trade.closed")} count={closed.length} selected={tab === "closed"} onPress={() => setTab("closed")} />
      </View>
      {shown.length === 0 ? (
        <Text style={{ color: color.ink2, fontSize: 14, textAlign: "center", paddingVertical: space(8) }}>{t("trade.noTrades")}</Text>
      ) : (
        shown.map((x) =>
          tab === "open" ? (
            <OpenRow key={x.id} trade={x} assets={assets} currency={currency} />
          ) : (
            <ClosedRow key={x.id} trade={x} assets={assets} currency={currency} />
          ),
        )
      )}
    </View>
  );
}

/** The selected account's trades: Open (live countdown, soonest first) and Closed (newest first). */
export const TradesSheet = forwardRef<SheetRef, { accountId: string; assets: readonly AppAsset[]; currency: string }>(function TradesSheet(
  { accountId, assets, currency },
  ref,
) {
  const { t } = useTranslation();
  return (
    <Sheet ref={ref} title={t("trade.trades")} snapPoints={SNAP_POINTS} scroll>
      <TradesBody accountId={accountId} assets={assets} currency={currency} />
    </Sheet>
  );
});
