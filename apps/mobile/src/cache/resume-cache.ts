import { createMMKV } from "react-native-mmkv";
import { decodeResume, encodeResume, type ResumeSnapshot } from "./codec";

/**
 * Thin MMKV wrapper around the pure codec (all validation and trimming live there, and are tested there).
 * Every call is best effort: a storage failure must never break the Trade screen or a sign-out.
 */
const store = createMMKV({ id: "ixt-resume" });
const key = (userId: string) => `resume:${userId}`;
const LAST_USER_KEY = "lastUserId";

/** A snapshot read back from disk. `stale` is always true: it was not produced by this run's live data. */
export interface CachedResume {
  snapshot: ResumeSnapshot;
  stale: true;
}

export function saveResume(s: ResumeSnapshot): void {
  try {
    store.set(key(s.userId), encodeResume(s));
  } catch {
    // Losing a cache write only costs the next cold start its instant paint.
  }
}

/**
 * The cached snapshot for `userId`, marked stale, or null when none is usable (missing, corrupt, another
 * user's, or older than 24h). It reads and parses synchronously, so call it ONCE (e.g. in a `useState`
 * initializer), never on every render.
 */
export function loadResume(userId: string): CachedResume | null {
  try {
    const snapshot = decodeResume(store.getString(key(userId)), Date.now(), userId);
    return snapshot ? { snapshot, stale: true } : null;
  } catch {
    return null;
  }
}

/** Remember who was signed in so a cold start can paint their cache before bootstrap returns. */
export function saveLastUserId(userId: string): void {
  try {
    store.set(LAST_USER_KEY, userId);
  } catch {
    // Best effort, see above.
  }
}

export function loadLastUserId(): string | null {
  try {
    return store.getString(LAST_USER_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Wipes every snapshot and the remembered user id. Called on sign-out. */
export function clearResume(): void {
  try {
    store.clearAll();
  } catch {
    // Best effort, see above.
  }
}
