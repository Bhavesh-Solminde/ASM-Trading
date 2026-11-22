export interface AccountActor {
  role: "USER"|"ADMIN"|"AFFILIATE";
  accountType: "LIVE"|"DEMO";
  /**
   * User.legacySimulated from the authoritative database row. Absent in durable
   * commands written before affiliate Phase 2 (every affiliate then was a retired
   * simulated one), so an AFFILIATE counts as real only when this is explicitly false.
   */
  legacySimulated?: boolean;
  /** User.marketExempt from the database. Older durable commands default to false. */
  marketExempt?: boolean;
}

/** Market participant: an eligible regular user or non-legacy affiliate. */
export function isRealTrader(actor:Pick<AccountActor,"role"|"legacySimulated"|"marketExempt">):boolean {
  return actor.marketExempt !== true && (actor.role==="USER" || (actor.role==="AFFILIATE" && actor.legacySimulated===false));
}

/** Call with authoritative database identity, never request payload fields. */
export function isTob(actor:AccountActor):boolean {
  return isRealTrader(actor) && actor.accountType==="LIVE";
}
