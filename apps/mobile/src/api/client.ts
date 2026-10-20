import * as Device from "expo-device";
import type { ZodType } from "zod";
import { appConfig } from "@/config";
import { useGate } from "@/gate/gate-store";
import { ApiError, classifyResponse, clearsGate, resolveAuth } from "./errors";

let tokenProvider: () => string | null = () => null;
let onLogout: () => void = () => {};
let onToast: (message: string) => void = () => {};

/** Wired once by the session store and toast host at startup. */
export function configureApi(opts: { token: () => string | null; logout: () => void; toast: (m: string) => void }) {
  tokenProvider = opts.token;
  onLogout = opts.logout;
  onToast = opts.toast;
}

export async function api<T = unknown>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    form?: FormData;
    schema?: ZodType<T>;
    auth?: boolean;
    token?: string;
    /** Throw on a 429 instead of toasting it: for callers that back off and retry on their own. */
    silentRateLimit?: boolean;
    /**
     * Abort after this many ms and throw an ApiError with code "timeout". React Native's fetch has no timeout of its
     * own, so a request stalled on a dead connection would otherwise wait forever. The server may still have acted:
     * the caller must reconcile, not retry.
     */
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const { apiUrl, version } = appConfig();
  const headers: Record<string, string> = {
    "X-Client": `app/${version}`,
    "X-Device-Name": Device.modelName ?? "Android",
    Accept: "application/json",
  };
  // An explicit token (the sign-out logout, sent after the session is cleared) never takes the session-loss path.
  const { token, authed } = resolveAuth(opts, tokenProvider);
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const controller = opts.timeoutMs !== undefined ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
  const timedOut = () => new ApiError("The request timed out.", 0, "timeout");
  let res: Response;
  let json: unknown;
  try {
    try {
      res = await fetch(`${apiUrl}${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, ...(controller ? { signal: controller.signal } : {}) });
    } catch {
      throw controller?.signal.aborted ? timedOut() : new ApiError("No connection.", 0, "offline");
    }
    json = res.status === 204 ? null : await res.json().catch(() => null);
    // The body read is covered by the same deadline: an abort mid-body is a timeout, not an empty answer.
    if (controller?.signal.aborted) throw timedOut();
  } finally {
    if (timer) clearTimeout(timer);
  }

  const verdict = classifyResponse(res.status, json, { authed, silentRateLimit: opts.silentRateLimit });
  switch (verdict.kind) {
    case "ok":
      if (clearsGate(path) && useGate.getState().gate !== "ok") useGate.getState().setGate("ok");
      return opts.schema ? opts.schema.parse(json) : (json as T);
    case "logout":
      // Only the session this request carried is gone; a newer sign-in made while it was in flight stays.
      if (tokenProvider() === token) onLogout();
      throw new ApiError("Not signed in.", 401, "unauthenticated");
    case "gate":
      useGate.getState().setGate(verdict.gate);
      throw new ApiError(verdict.gate, res.status, verdict.gate);
    case "toast":
      onToast(verdict.message);
      throw new ApiError(verdict.message, res.status, "rate_limited");
    case "error":
      throw new ApiError(verdict.message, verdict.status, verdict.code);
  }
}
