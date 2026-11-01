import { configurePushCleanup } from "./cleanup";
// push.ts
import * as Notifications from "expo-notifications";
import { createMMKV } from "react-native-mmkv";
import { Platform } from "react-native";
import { useSession } from "@/auth/session-store";
import { api } from "@/api/client";
import { shouldAskPermission } from "./permission-moment";

const store = createMMKV({ id: "ixt-push" });
const ASKED = "asked";
const TOKEN = "token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function setupChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("trades", { name: "Trades", importance: Notifications.AndroidImportance.HIGH });
  await Notifications.setNotificationChannelAsync("payments", { name: "Payments", importance: Notifications.AndroidImportance.HIGH });
  await Notifications.setNotificationChannelAsync("account", { name: "Account", importance: Notifications.AndroidImportance.DEFAULT });
}

let registration: Promise<void> = Promise.resolve();
let registeredSession: string | null = null;
export function registerDevice(): Promise<void> {
  const session = useSession.getState().token;
  registration = registration.catch(() => {}).then(() => registerFor(session));
  return registration;
}
async function nativeWithin<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Push setup timed out")), 10_000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function registerFor(session: string | null): Promise<void> {
  if (!session || useSession.getState().token !== session || Platform.OS !== "android") return;
  const perm = await nativeWithin(Notifications.getPermissionsAsync());
  if (perm.status !== "granted") return;
  const { data: token } = await nativeWithin(Notifications.getDevicePushTokenAsync());
  if (typeof token !== "string") return;
  if (useSession.getState().token !== session) return;
  await api("/api/v1/push/devices", { method: "POST", token: session, timeoutMs: 10_000, body: { platform: "ANDROID", token } });
  if (useSession.getState().token === session) { store.set(TOKEN, token); registeredSession = session; }
  else await api("/api/v1/push/devices", { method: "DELETE", token: session, timeoutMs: 5_000, body: { token } }).catch(() => {});
}

export async function unregisterDevice(session?: string): Promise<void> {
  const owned = registeredSession === null || registeredSession === session;
  const token = owned ? store.getString(TOKEN) : undefined;
  if (owned) { store.remove(TOKEN); registeredSession = null; }
  // Registration checks the departed session and removes its own late result. Wait before remote revocation.
  await registration.catch(() => {});
  if (!token) return;
  await api("/api/v1/push/devices", { method: "DELETE", ...(session ? { token: session } : {}), timeoutMs: 5_000, body: { token } }).catch(() => {});
}

export async function askPermissionAt(event: "live_trade_settled" | "deposit_created" | "other"): Promise<void> {
  const perm = await nativeWithin(Notifications.getPermissionsAsync());
  const status = perm.status === "granted" ? "granted" : perm.canAskAgain ? "undetermined" : "denied";
  if (!shouldAskPermission({ asked: store.getBoolean(ASKED) ?? false, status, event })) return;
  store.set(ASKED, true);
  const res = await Notifications.requestPermissionsAsync();
  if (res.status === "granted") await registerDevice();
}

/** FCM rotates tokens; keep the server's copy current. */
export function watchTokenRefresh(): () => void {
  const sub = Notifications.addPushTokenListener(() => void registerDevice().catch(() => {}));
  return () => sub.remove();
}

configurePushCleanup(unregisterDevice);
