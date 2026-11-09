import { compareVersions } from "@asm/client-core";
export function updatePrompt(s: {
  variant: "play" | "direct";
  current: string;
  latest: string;
  dismissedVersion: string | null;
}): "none" | "prompt" {
  return s.variant === "direct" &&
    /^\d+\.\d+\.\d+$/.test(s.latest) &&
    compareVersions(s.current, s.latest) < 0 &&
    s.dismissedVersion !== s.latest
    ? "prompt"
    : "none";
}
export function updateUrl(apiUrl: string, path: string): string | null {
  try {
    const origin = new URL(apiUrl);
    const url = new URL(path, origin);
    return url.origin === origin.origin &&
      url.protocol === "https:" &&
      /^\/download\/app(?:\/\d+\.\d+\.\d+)?$/.test(url.pathname) &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}
