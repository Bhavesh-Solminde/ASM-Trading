export type Locale = "en" | "hi";

export function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object" ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

export function localeFromDevice(tags: string[]): Locale {
  return tags[0]?.toLowerCase().startsWith("hi") ? "hi" : "en";
}

/** The language the user picked on the login screen wins over the device language. */
export function resolveLocale(saved: string | null, deviceTags: string[]): Locale {
  return saved === "en" || saved === "hi" ? saved : localeFromDevice(deviceTags);
}
