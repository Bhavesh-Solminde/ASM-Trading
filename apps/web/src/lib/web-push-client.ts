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

/** Bound native browser operations as well as fetch: signing out must never wait on a stalled worker. */
async function bounded<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 3000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Rebind a persisted endpoint to the currently authenticated cookie before considering it enabled.
 * Invoked by the signed-in shell, even if Account/Notifications is never opened.
 * A rejected/expired session must stop using the old subscription locally.
 */
export async function syncExistingWebPush(): Promise<boolean> {
  return bounded(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return false;
    try {
      const body = deviceBody(sub.toJSON());
      if (!body) throw Error("Invalid subscription");
      const response = await fetch("/api/v1/push/devices", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw Error("Registration refused");
      return true;
    } catch {
      await sub.unsubscribe().catch(() => false);
      return false;
    }
  }, false);
}

/** Best effort local removal before the cookie is revoked, bounded across the entire operation. */
export async function unregisterWebPush(): Promise<void> {
  return bounded(async () => {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const token = sub.endpoint;
    await sub.unsubscribe();
    await fetch("/api/v1/push/devices", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(2500),
    });
  }, undefined);
}
