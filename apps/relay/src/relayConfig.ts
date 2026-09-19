import type { RelayConfig } from "./types";

// There is no Settings screen (Plan 06's original design cut it — see
// docs/superpowers/plans/README.md). Edit these values and rebuild.
//
// serverUrl now points at apps/web directly (not apps/harness — see
// docs/superpowers/specs/2026-09-13-bank-feed-deposit-verification-design.md).
// apps/web is not permanently deployed, so during a test session expose it
// with a tunnel (e.g. `ngrok http 3000`) and paste the tunnel's https URL
// here, then rebuild. The path (`/api/bank-feed/sms`) and the
// Authorization header logic below are unchanged — only this base URL
// and the shared secret (must match apps/web's SMS_RELAY_SECRET env var)
// need updating.
export const RELAY_CONFIG: RelayConfig = {
  serverUrl: "https://REPLACE-WITH-YOUR-TUNNEL-URL.ngrok-free.app",
  secret: "dev-only-relay-secret-change-me",
  senders: ["SBI"],
  deviceLabel: "Bhavesh's phone",
};
