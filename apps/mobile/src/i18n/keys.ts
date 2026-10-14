export type Locale = "en" | "hi";

export function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object" ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

export function localeFromDevice(tags: string[]): Locale {
  return tags[0]?.toLowerCase().startsWith("hi") ? "hi" : "en";
}
