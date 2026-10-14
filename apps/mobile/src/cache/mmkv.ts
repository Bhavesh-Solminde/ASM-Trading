import { createMMKV, type MMKV } from "react-native-mmkv";

const opened = new Map<string, MMKV>();

/**
 * The MMKV instance for `id`, opened on first use. Never call `createMMKV` at module scope: it is a native
 * call, and one that throws would crash app boot through whatever imported the module (the session store
 * imports the resume cache). Null when the native module is unavailable, so callers degrade to "no cache".
 */
export function openMmkv(id: string): MMKV | null {
  const existing = opened.get(id);
  if (existing) return existing;
  try {
    const store = createMMKV({ id });
    opened.set(id, store);
    return store;
  } catch {
    return null;
  }
}
