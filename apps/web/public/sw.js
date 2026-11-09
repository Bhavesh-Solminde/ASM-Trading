/* Push-only worker: no fetch handler and no cached balances or trades. */
function target(value) {
  try { const url = new URL(typeof value === "string" ? value : "/history", self.location.origin);
    return url.origin === self.location.origin && /^\/(history|account|trade)(\/|\?|$)/.test(url.pathname + url.search) ? url.href : new URL("/history", self.location.origin).href;
  } catch { return new URL("/history", self.location.origin).href; }
}
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* malformed push */ }
  if (!data || typeof data !== "object") data = {};
  event.waitUntil(self.registration.showNotification(typeof data.title === "string" ? data.title : "IndianxTrade", {
    body: typeof data.body === "string" ? data.body : "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: {url:target(data.url)},
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close(); const url = target(event.notification.data?.url);
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({type:"window", includeUncontrolled:true})) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try { await client.navigate(url); return await client.focus(); } catch { /* try another window */ }
    }
    return self.clients.openWindow(url);
  })());
});
