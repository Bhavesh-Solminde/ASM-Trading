import * as Device from "expo-device";
import type { ZodType } from "zod";
import { appConfig } from "@/config";
import { useGate } from "@/gate/gate-store";
import { ApiError, classifyResponse, clearsGate } from "./errors";

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
  opts: { method?: string; body?: unknown; form?: FormData; schema?: ZodType<T>; auth?: boolean } = {},
): Promise<T> {
  const { apiUrl, version } = appConfig();
  const headers: Record<string, string> = {
    "X-Client": `app/${version}`,
    "X-Device-Name": Device.modelName ?? "Android",
    Accept: "application/json",
  };
  const authed = opts.auth !== false;
  const token = authed ? tokenProvider() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError("No connection.", 0, "offline");
  }

  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  const verdict = classifyResponse(res.status, json, { authed });
  switch (verdict.kind) {
    case "ok":
      if (clearsGate(path) && useGate.getState().gate !== "ok") useGate.getState().setGate("ok");
      return opts.schema ? opts.schema.parse(json) : (json as T);
    case "logout":
      onLogout();
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
