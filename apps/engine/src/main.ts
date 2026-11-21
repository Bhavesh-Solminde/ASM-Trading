import { logger } from "@asm/logger";
import { startOtcEngine } from "./otc/boot";

// The engine is the OTC order-book market plus the background jobs it hosts
// (deposits, chain watchers, affiliate, push). startOtcEngine installs its own
// shutdown and crash handlers.
void startOtcEngine().catch((err: unknown) => {
  logger.error(
    { evt: "engine.start_failed", reason: err instanceof Error ? err.message : "unknown" },
    "engine failed to start",
  );
  process.exit(1);
});
