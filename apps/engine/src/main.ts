import { logger } from "@asm/logger";
import { startOtcEngine } from "./otc/boot";

// The trading engine: the OTC order-book market, its sockets and trade push.
// Background jobs run in their own process (src/jobs.ts). startOtcEngine
// installs its own shutdown and crash handlers.
void startOtcEngine().catch((err: unknown) => {
  logger.error(
    { evt: "engine.start_failed", reason: err instanceof Error ? err.message : "unknown" },
    "engine failed to start",
  );
  process.exit(1);
});
