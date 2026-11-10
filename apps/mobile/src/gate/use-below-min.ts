import { compareVersions } from "@asm/client-core";
import { useAppConfig } from "@/api/queries";
import { appConfig } from "@/config";

/** True when the server's minimum app version is newer than this build. */
export function useBelowMin(): boolean {
  const minVersion = useAppConfig().data?.minVersion;
  return minVersion !== undefined && compareVersions(appConfig().version, minVersion) < 0;
}
