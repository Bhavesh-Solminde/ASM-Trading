import { randomBytes } from "node:crypto";

/** Short id stamped on every log line belonging to one request or operation. */
export function newCorrelationId(): string {
  return randomBytes(3).toString("hex");
}
