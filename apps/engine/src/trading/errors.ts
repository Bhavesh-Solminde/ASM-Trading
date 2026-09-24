export type DeskRejectionReason =
  | "unknown_asset"
  | "account_not_found"
  | "insufficient_funds"
  | "account_not_active"
  | "market_closed";

/** An expected refusal, mapped to a 4xx by the control surface — never a 500. */
export class DeskRejection extends Error {
  constructor(readonly reason: DeskRejectionReason) {
    super(reason);
    this.name = "DeskRejection";
  }
}
