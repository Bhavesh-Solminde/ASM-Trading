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
