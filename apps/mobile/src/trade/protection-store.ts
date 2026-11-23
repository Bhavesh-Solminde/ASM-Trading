import { create } from "zustand";
import { openMmkv } from "@/cache/mmkv";

const KEY = "post-trade-stops";

export const useProtection = create<{ enabled: boolean; toggle: () => void }>((set, get) => ({
  enabled: readPreference(),
  toggle: () => {
    const enabled = !get().enabled;
    set({ enabled });
    try {
      openMmkv("ixt-prefs")?.set(KEY, enabled);
    } catch {
      // The switch still works until the app closes if device storage is unavailable.
    }
  },
}));

function readPreference(): boolean {
  try {
    return openMmkv("ixt-prefs")?.getBoolean(KEY) === true;
  } catch {
    return false;
  }
}
