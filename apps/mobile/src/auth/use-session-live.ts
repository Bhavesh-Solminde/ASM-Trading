import { useLock } from "@/lock/lock-store";
import { sessionLive } from "./session-live";
import { useSession } from "./session-store";

/** `sessionLive` read from the stores. Every hook runs on every render; only the values combine. */
export function useSessionLive(): boolean {
  const ready = useSession((s) => s.ready);
  const token = useSession((s) => s.token);
  const lockLoaded = useLock((s) => s.loaded);
  const locked = useLock((s) => s.locked);
  return sessionLive({ ready, token, lockLoaded, locked });
}
