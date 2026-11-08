export const FESTIVAL_SOUND_KEY = "indianxtrade:diwali:2026:sound";
export const FESTIVAL_MOTION_KEY = "indianxtrade:diwali:2026:animation";
const fallback = new Map<string, boolean>();
export function festivalSoundEnabled() {
  try { return localStorage.getItem(FESTIVAL_SOUND_KEY) === "on"; } catch { return fallback.get(FESTIVAL_SOUND_KEY) ?? false; }
}
export function festivalMotionEnabled() {
  try { return localStorage.getItem(FESTIVAL_MOTION_KEY) !== "off"; } catch { return fallback.get(FESTIVAL_MOTION_KEY) ?? true; }
}
export function setFestivalPreference(key: typeof FESTIVAL_SOUND_KEY | typeof FESTIVAL_MOTION_KEY, on: boolean) {
  fallback.set(key, on);
  try { localStorage.setItem(key, on ? "on" : "off"); } catch { /* Retain the current-page preference. */ }
  window.dispatchEvent(new Event("diwali:preference"));
}
export function subscribeFestivalPreferences(listener: () => void) {
  window.addEventListener("storage", listener); window.addEventListener("diwali:preference", listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener("diwali:preference", listener); };
}
