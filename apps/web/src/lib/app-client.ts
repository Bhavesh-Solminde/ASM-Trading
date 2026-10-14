/**
 * Headers the native app sends on every request. proxy.ts imports this, so it stays cheap:
 * the only import is the pure compareVersions module (a deep path, not the client-core barrel).
 *   X-Client: app/<major>.<minor>.<patch>
 *   X-Device-Name: <model>
 */
const APP_CLIENT = /^app\/(\d+\.\d+\.\d+)$/;

export function appVersionFrom(headers: Pick<Headers, "get">): string | null {
  const match = APP_CLIENT.exec(headers.get("x-client")?.trim() ?? "");
  return match?.[1] ?? null;
}

export function isAppRequest(headers: Pick<Headers, "get">): boolean {
  return appVersionFrom(headers) !== null;
}

export function deviceNameFrom(headers: Pick<Headers, "get">): string | null {
  const raw = headers.get("x-device-name")?.trim();
  return raw ? raw.slice(0, 80) : null;
}

export { compareVersions } from "@asm/client-core/src/time/version";
