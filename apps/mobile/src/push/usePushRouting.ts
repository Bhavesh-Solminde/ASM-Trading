import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { pushTarget } from "./push-target";

export function usePushRouting(ready: boolean) {
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !last) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const url = pushTarget(last.notification.request.content.data?.url);
    if (url) router.push(url as never);
    void Notifications.clearLastNotificationResponseAsync();
  }, [ready, last]);
}
