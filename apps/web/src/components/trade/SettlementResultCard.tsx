import type { TradeView } from "@asm/contracts";
import { Icon } from "@/components/shell/Icon";
import { closedRowDisplay, settledAmountText } from "@asm/client-core";

export function SettlementResultCard({ trade, currency, pair, onDismiss }: {
  trade: TradeView;
  currency: string;
  pair: string;
  onDismiss: () => void;
}) {
  const { sign } = closedRowDisplay(trade);
  const color = sign === "+" ? "bg-up text-up-ink" : sign === "−" ? "bg-down text-down-ink" : "bg-tile text-ink";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[40%] z-20 grid place-items-center px-4">
      <div className={`result-pop pointer-events-auto relative grid gap-0.5 rounded-md py-1.5 pl-3 pr-6 text-center shadow-[0_14px_34px_-12px_rgba(0,0,0,.85)] ${color}`}>
        <button
          type="button"
          aria-label="Dismiss result"
          onClick={onDismiss}
          className="absolute right-1 top-1 grid size-4 place-items-center rounded-full opacity-70 hover:bg-black/10 hover:opacity-100"
        >
          <Icon name="close" className="size-3" />
        </button>
        <span className="text-[8px] font-bold uppercase tracking-[0.14em] opacity-80">
          {trade.status === "WON" ? "Payout" : "Result"} · {pair}
        </span>
        <span className="led text-[17px] font-black leading-none">
          {settledAmountText(trade, currency)}
        </span>
      </div>
    </div>
  );
}
