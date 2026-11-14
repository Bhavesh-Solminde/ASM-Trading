export interface AccountActor {
  role: "USER"|"ADMIN"|"AFFILIATE";
  accountType: "LIVE"|"DEMO";
  /**
   * User.legacySimulated from the authoritative database row. Absent in durable
   * commands written before affiliate Phase 2 (every affiliate then was a retired
   * simulated one), so an AFFILIATE counts as real only when this is explicitly false.
   */
  legacySimulated?: boolean;
}

/** Real-money market participant: a regular user or a non-legacy affiliate. ADMIN never is. */
export function isRealTrader(actor:Pick<AccountActor,"role"|"legacySimulated">):boolean {
  return actor.role==="USER" || (actor.role==="AFFILIATE" && actor.legacySimulated===false);
}

/** Call with authoritative database identity, never request payload fields. */
export function isTob(actor:AccountActor):boolean {
  return isRealTrader(actor) && actor.accountType==="LIVE";
}
