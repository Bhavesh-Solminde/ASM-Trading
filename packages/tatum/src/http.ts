export const TATUM_API_BASE = "https://api.tatum.io";
export const TATUM_TIMEOUT_MS = 10_000;

export class TatumError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "TatumError";
  }
}

/**
 * One Tatum HTTP call: x-api-key auth, JSON in/out, a hard timeout. Non-2xx
 * and network failures throw TatumError; callers treat a throw as "this step
 * failed, change nothing, retry later". `allow404` returns null on a 404
 * instead (e.g. "tx not found yet").
 */
export async function tatumRequest<T>(
  fetchImpl: typeof fetch,
  apiKey: string,
  url: string,
  init: { method?: string; body?: unknown; allow404?: boolean } = {},
): Promise<T | null> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TATUM_TIMEOUT_MS),
    });
  } catch (err) {
    throw new TatumError(`Tatum request failed: ${(err as Error).message}`, null);
  }

  if (res.status === 404 && init.allow404) return null;
  const text = await res.text();
  if (!res.ok) {
    // Tatum error bodies carry a message/errorCode; never echo the API key.
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { message?: string; errorCode?: string };
      detail = [j.errorCode, j.message].filter(Boolean).join(": ") || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new TatumError(`Tatum ${res.status} on ${new URL(url).pathname}: ${detail}`, res.status);
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TatumError(`Tatum returned non-JSON on ${new URL(url).pathname}`, res.status);
  }
}

/** JSON-RPC 2.0 call through a Tatum RPC gateway. Throws TatumError on an RPC error object. */
export async function tatumRpc<T>(
  fetchImpl: typeof fetch,
  apiKey: string,
  gatewayUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const body = await tatumRequest<{ result?: T; error?: { code: number; message: string } }>(fetchImpl, apiKey, gatewayUrl, {
    method: "POST",
    body: { jsonrpc: "2.0", id: 1, method, params },
  });
  if (!body) throw new TatumError(`Empty JSON-RPC response for ${method}`, null);
  if (body.error) throw new TatumError(`RPC ${method} error ${body.error.code}: ${body.error.message}`, null);
  return body.result as T;
}
