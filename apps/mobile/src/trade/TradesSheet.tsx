import { forwardRef, memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { closedRowDisplay } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { fmtPrice } from "@/chart/format-price";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { FigText } from "@/ui/FigText";
import { LedgerHeader, LedgerRow, type LedgerColumn } from "@/ui/Ledger";
import { Money } from "@/ui/Money";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { Stamp } from "@/ui/Stamp";
import { ledgerStamp } from "./closed-stamp";
import { countdownText } from "./countdown-text";
import { dayNetMinor } from "./day-total";
import type { AppAsset } from "./markets";
import { useLiveTrade } from "./useLiveTrade";

const SNAP_POINTS = ["60%", "90%"];
const NO_TRADES: readonly TradeView[] = [];
/** The columns of A-Trades. Every cell sits at the top of the row (the TIME cell too), like the canvas grid. */
const COLS: LedgerColumn[] = [{ width: 54, valign: "top" }, { flex: 1, valign: "top" }, { width: 104, align: "right", valign: "top" }];
/** Open trades: a little wider TIME column, because the countdown can read "Settling…". */
const OPEN_COLS: LedgerColumn[] = [{ width: 64, valign: "top" }, ...COLS.slice(1)];
/** The TIME text is 13px against the 15px name beside it: 2pt lower puts both on one centre line, as on the canvas. */
const TIME_NUDGE = 2;

type Tab = "open" | "closed";

const STAMP: Record<Exclude<TradeView["status"], "OPEN">, { key: "trade.statusWon" | "trade.statusLost" | "trade.statusRefund"; tone: "up" | "down" | "muted" }> = {
  WON: { key: "trade.statusWon", tone: "up" },
  LOST: { key: "trade.statusLost", tone: "down" },
  REFUNDED: { key: "trade.statusRefund", tone: "muted" },
};

function assetOf(assets: readonly AppAsset[], symbol: string) {
  return assets.find((a) => a.symbol === symbol);
}

/** The name never truncates the side word: only the name gives way. */
function TradeCell({ name, side, up, detail }: { name: string; side: string; up: boolean; detail: string }) {
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <Txt weight={600} size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </Txt>
        <Txt weight={600} size={15} color={up ? color.up : color.downText}>
          {` ${side}`}
        </Txt>
      </View>
      <FigText text={detail} size={11} tracking={-0.03} color={color.ink3} numberOfLines={2} />
    </>
  );
}

/** Ticks on its own each second, so settled rows and the rest of the sheet never re-render for it. */
const OpenRow = memo(function OpenRow({ trade, assets, currency }: { trade: TradeView; assets: readonly AppAsset[]; currency: string }) {
  const { t } = useTranslation();
  const live = useLiveTrade(trade);
  const { pnl } = live;
  const asset = assetOf(assets, trade.symbol);
  const name = asset?.displayName ?? trade.symbol;
  const up = trade.direction === "UP";
  const side = up ? t("trade.up") : t("trade.down");
  const time = countdownText(live, t("trade.settling"));
  const pnlText = pnl === null ? "—" : `${pnl.sign}${money(pnl.amountMinor, currency)}`;
  const detail = `${money(trade.stake, currency, { trim: true })} · ${fmtPrice(trade.entryPrice, asset?.precision ?? 5)}`;
  return (
    <LedgerRow
      columns={OPEN_COLS}
      accessibilityLabel={`${name} ${side}, ${time}, ${pnlText}`}
      cells={[
        <View key="time" style={{ paddingTop: TIME_NUDGE }}>
          <FigText text={time} size={live.expired ? 11 : 13} color={color.ink} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} />
        </View>,
        <TradeCell key="trade" name={name} side={side} up={up} detail={detail} />,
        pnl === null ? (
          <Money key="result" text="—" size={14} weight={500} color={color.ink3} />
        ) : (
          <Money key="result" text={pnlText} size={14} weight={600} color={pnl.tone === "up" ? color.up : color.downText} />
        ),
      ]}
    />
  );
});

const ClosedRow = memo(function ClosedRow({ trade, assets, currency, nowMs }: { trade: TradeView; assets: readonly AppAsset[]; currency: string; nowMs: number }) {
  const { t } = useTranslation();
  const display = closedRowDisplay(trade);
  const asset = assetOf(assets, trade.symbol);
  const name = asset?.displayName ?? trade.symbol;
  const precision = asset?.precision ?? 5;
  const up = trade.direction === "UP";
  const side = up ? t("trade.up") : t("trade.down");
  const when = ledgerStamp(trade.expiryTs, nowMs);
  const entry = fmtPrice(trade.entryPrice, precision);
  const prices = trade.exitPrice !== null ? t("trade.priceRange", { from: entry, to: fmtPrice(trade.exitPrice, precision) }) : entry;
  const detail = `${money(trade.stake, currency, { trim: true })} · ${prices}`;
  const amount = `${display.sign}${money(display.amountMinor, currency)}`;
  const stamp = trade.status === "OPEN" ? null : STAMP[trade.status];
  const amountColor = display.sign === "+" ? color.up : display.sign === "−" ? color.downText : color.ink2;
  return (
    <LedgerRow
      columns={COLS}
      accessibilityLabel={`${when.date ? `${when.date} ` : ""}${when.time} ${name} ${side}, ${detail}, ${amount}${stamp ? `, ${t(stamp.key)}` : ""}`}
      cells={[
        <View key="time" style={{ paddingTop: TIME_NUDGE }}>
          <Txt font="fig" size={13} color={color.ink2}>
            {when.time}
          </Txt>
          {when.date ? (
            <Txt font="fig" size={10} color={color.ink3}>
              {when.date}
            </Txt>
          ) : null}
        </View>,
        <TradeCell key="trade" name={name} side={side} up={up} detail={detail} />,
        <View key="result" style={{ alignItems: "flex-end", gap: 5 }}>
          <Money text={amount} size={14} weight={600} color={amountColor} />
          {stamp ? <Stamp label={t(stamp.key)} tone={stamp.tone} /> : null}
        </View>,
      ]}
    />
  );
});

/** Mounted only while the sheet is presented, so the store subscription and the row clocks exist only then. */
function TradesBody({ accountId, accountType, assets, currency }: { accountId: string; accountType: "DEMO" | "LIVE"; assets: readonly AppAsset[]; currency: string }) {
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
  const nowMs = Date.now();
  const net = dayNetMinor(trades, nowMs);
  const shown = tab === "open" ? open : closed;
  return (
    <View>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 10 }}>
        <Chip role="tab" label={t("trade.open")} count={open.length} selected={tab === "open"} onPress={() => setTab("open")} size={15} style={{ paddingHorizontal: 16 }} />
        <Chip role="tab" label={t("trade.closed")} count={closed.length} selected={tab === "closed"} onPress={() => setTab("closed")} size={15} style={{ paddingHorizontal: 16 }} />
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <LedgerHeader columns={tab === "open" ? OPEN_COLS : COLS} labels={[t("trade.colTime"), t("trade.colTrade"), t("trade.colResult")]} />
        {shown.length === 0 ? (
          <Txt color={color.ink2} style={{ textAlign: "center", paddingVertical: 32 }}>
            {t("trade.noTrades")}
          </Txt>
        ) : (
          shown.map((x) =>
            tab === "open" ? (
              <OpenRow key={x.id} trade={x} assets={assets} currency={currency} />
            ) : (
              <ClosedRow key={x.id} trade={x} assets={assets} currency={currency} nowMs={nowMs} />
            ),
          )
        )}
      </View>
      {net !== null ? (
        <View style={{ marginTop: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, borderTopWidth: 1, borderTopColor: color.rule, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Txt size={15} color={color.ink2}>
            {t("trade.todayAccount", { account: accountType === "LIVE" ? t("trade.live") : t("trade.demo") })}
          </Txt>
          <Money text={`${net > 0 ? "+" : ""}${money(net, currency)}`} size={16} weight={600} color={net > 0 ? color.up : net < 0 ? color.downText : color.ink2} />
        </View>
      ) : (
        <View style={{ height: 28 }} />
      )}
    </View>
  );
}

/** The selected account's trades as a small passbook: Open (live countdown) and Closed (stamped), with today's total. */
export const TradesSheet = forwardRef<SheetRef, { accountId: string; accountType: "DEMO" | "LIVE"; assets: readonly AppAsset[]; currency: string }>(function TradesSheet(
  { accountId, accountType, assets, currency },
  ref,
) {
  const { t } = useTranslation();
  return (
    <Sheet ref={ref} title={t("trade.yourTrades")} snapPoints={SNAP_POINTS} scroll flush>
      <TradesBody accountId={accountId} accountType={accountType} assets={assets} currency={currency} />
    </Sheet>
  );
});
