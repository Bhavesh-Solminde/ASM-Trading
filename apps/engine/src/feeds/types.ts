export interface Quote {
  readonly symbol: string;
  readonly price: number;
  /** Epoch seconds. */
  readonly ts: number;
}

export interface PriceFeed {
  start(onQuote: (quote: Quote) => void): Promise<void>;
  stop(): Promise<void>;
}
