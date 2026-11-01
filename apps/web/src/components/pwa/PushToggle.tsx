"use client";
import { useEffect, useRef, useState } from "react";
import { browserStandalone, canOfferWebPush } from "@/lib/install-rules";
import { deviceBody, urlBase64ToUint8Array } from "@/lib/web-push-client";
/** Permission is requested synchronously from a tap, never from mounting this component. */
export function PushToggle() {
  const [offer, setOffer] = useState(false),
    [on, setOn] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let live = true;
    const ok =
      canOfferWebPush({
        standalone: browserStandalone(),
        hasPushManager: "PushManager" in window,
        hasNotification: "Notification" in window,
      }) && "serviceWorker" in navigator;
    setOffer(ok);
    if (ok)
      void navigator.serviceWorker
        .getRegistration("/")
        .then((r) => r?.pushManager.getSubscription())
        .then((s) => {
          if (live) setOn(!!s);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  async function toggle() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let created: PushSubscription | null = null;
    try {
      if (!on && (await Notification.requestPermission()) !== "granted") {
        setError(
          "Allow notifications in your device settings to receive alerts.",
        );
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (on) {
        if (existing) {
          const r = await fetch("/api/v1/push/devices", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: existing.endpoint }),
          });
          if (!r.ok) throw Error();
          await existing.unsubscribe();
        }
        setOn(false);
        return;
      }
      const r = await fetch("/api/v1/push/vapid");
      if (!r.ok) throw Error();
      const cfg = (await r.json()) as { publicKey?: string };
      if (!cfg.publicKey) throw Error();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
        }));
      if (!existing) created = sub;
      const body = deviceBody(sub.toJSON());
      if (!body) throw Error();
      const saved = await fetch("/api/v1/push/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!saved.ok) throw Error();
      setOn(true);
    } catch {
      if (created) await created.unsubscribe().catch(() => false);
      setError("Could not update notifications. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!offer) return null;
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={() => void toggle()}
        className="flex min-h-12 w-full items-center justify-between rounded-xl bg-tile px-4 text-left"
      >
        <span>Notifications</span>
        <span className="text-sm text-ink-2">
          {busy ? "Saving…" : on ? "On" : "Turn on"}
        </span>
      </button>
      {error ? (
        <p role="status" className="mt-2 text-sm text-down">
          {error}
        </p>
      ) : null}
    </div>
  );
}
