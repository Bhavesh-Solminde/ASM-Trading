/** A bank credit as it arrives from a feed, before it is persisted or matched. */
export interface Credit {
  amountInr: number;
  vpa: string;
  utr: string | null;
  receivedAt: Date;
  raw: string;
}

/**
 * A source of bank credits. `start` begins delivering credits to the callback;
 * `stop` halts delivery. The runner, not the feed, decides what to do with each
 * credit — mirroring the real SMS path, where the ingress route persists and
 * matches while the device only relays.
 */
export interface BankFeed {
  start(onCredit: (credit: Credit) => void): Promise<void>;
  stop(): Promise<void>;
}
