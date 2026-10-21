import { openMmkv } from "@/cache/mmkv";

/**
 * The deposit the user has started and not finished: its checkout token (and, once the pay screen has loaded it,
 * when it expires). Per user, so one phone shared by two people never shows one the other's payment. Best effort
 * both ways: a storage failure only costs the "Payment in progress" shortcut on Payments.
 */
export interface PendingCheckout {
  token: string;
  /** Epoch ms, or null until the pay screen has loaded the checkout. */
  expiresAt: number | null;
}

const store = () => openMmkv("ixt-pending-checkout");
const key = (userId: string) => `pending:${userId}`;

export function savePendingCheckout(userId: string, pending: PendingCheckout): void {
  try {
    store()?.set(key(userId), JSON.stringify(pending));
  } catch {
    // The payment still works; only the shortcut back to it is lost.
  }
}

export function loadPendingCheckout(userId: string): PendingCheckout | null {
  try {
    const raw = store()?.getString(key(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingCheckout> | null;
    if (!v || typeof v.token !== "string" || v.token === "") return null;
    if (v.expiresAt !== null && !(typeof v.expiresAt === "number" && Number.isFinite(v.expiresAt))) return null;
    return { token: v.token, expiresAt: v.expiresAt };
  } catch {
    return null;
  }
}

export function clearPendingCheckout(userId: string): void {
  try {
    store()?.remove(key(userId));
  } catch {
    // Nothing to clear if storage is gone.
  }
}
