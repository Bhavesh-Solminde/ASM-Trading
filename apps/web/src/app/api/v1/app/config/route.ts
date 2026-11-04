import { AppConfigSchema } from "@asm/contracts";
import { appConfigFromEnv } from "@/lib/app-config";
import { noStoreJson } from "@/lib/request-session";

/** Public: an old or signed-out app must be able to learn it needs an update. */
export function GET() {
  return noStoreJson(AppConfigSchema.parse(appConfigFromEnv()));
}
