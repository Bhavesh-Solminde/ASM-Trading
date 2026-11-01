export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(
    base64.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (base64.length % 4)) % 4),
  );
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export function deviceBody(sub: {
  endpoint?: string;
  keys?: Record<string, string>;
}) {
  const p256dh = sub.keys?.["p256dh"],
    auth = sub.keys?.["auth"];
  if (!sub.endpoint?.startsWith("https://") || !p256dh || !auth) return null;
  return { platform: "WEBPUSH" as const, token: sub.endpoint, p256dh, auth };
}

/** Best effort local removal before the cookie is revoked; never blocks sign-out. */
export async function unregisterWebPush(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    // Unsubscribe locally first so failed network cleanup cannot leak the old user's alerts.
    const token = sub.endpoint;
    await sub.unsubscribe();
    await fetch("/api/v1/push/devices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* logout still proceeds */
  }
}
