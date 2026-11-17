/** A program action refused for a business reason (Affiliate Program spec "Errors"). */
export class ProgramActionRefused extends Error {
  constructor(
    readonly code: string,
    message: string = code,
  ) {
    super(message);
    this.name = "ProgramActionRefused";
  }
}

/** A mandatory admin reason/note: trimmed, non-empty, at most 500 characters. */
export function cleanReason(reason: string, field = "reason"): string {
  const r = (reason ?? "").trim();
  if (!r) throw new ProgramActionRefused("invalid_input", `A ${field} is required.`);
  if (r.length > 500) throw new ProgramActionRefused("invalid_input", `The ${field} must be at most 500 characters.`);
  return r;
}
