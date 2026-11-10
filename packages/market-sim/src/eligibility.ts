export interface AccountActor {
  role: "USER"|"ADMIN"|"AFFILIATE";
  accountType: "LIVE"|"DEMO";
}

/** Call with authoritative database identity, never request payload fields. */
export function isTob(actor:AccountActor):boolean {
  return actor.role==="USER" && actor.accountType==="LIVE";
}
