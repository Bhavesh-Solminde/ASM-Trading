export const TATUM_API_BASE = "https://api.tatum.io";
export const TATUM_TIMEOUT_MS = 10_000;

export class TatumError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Tatum's own errorCode (e.g. "tron.tx.not.found"), when the body carried one. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "TatumError";
  }
}

/**
 * Process-wide pacing. Tatum's free tier allows 3 requests/second per API key
 * (exceeding it returns 429 — verified live); paid plans allow far more. Every
 * call reserves the next free slot, so bursts (e.g. a BSC verify fires three
 * RPCs) are spread out instead of rejected. TATUM_MAX_RPS raises the ceiling.
 */
let nextSlotAt = 0;
function maxRps(): number {
  const n = Number(process.env["TATUM_MAX_RPS"] ?? 3);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
async function takeSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + Math.ceil(1000 / maxRps());
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}
/** Test hook: forget pacing state. */
export function resetTatumPacing(): void {
  nextSlotAt = 0;
}

const RETRY_429_DELAYS_MS = [1_000, 2_000, 4_000];

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
  for (let attempt = 0; ; attempt++) {
    await takeSlot();
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
    const delay = RETRY_429_DELAYS_MS[attempt];
    if (res.status !== 429 || delay === undefined) break;
    await new Promise((r) => setTimeout(r, delay));
  }

  if (res.status === 404 && init.allow404) return null;
  const text = await res.text();
  if (!res.ok) {
    // Tatum error bodies carry a message/errorCode; never echo the API key.
    let detail = text.slice(0, 300);
    let code: string | null = null;
    try {
      const j = JSON.parse(text) as { message?: string; errorCode?: string };
      code = typeof j.errorCode === "string" ? j.errorCode : null;
      detail = [j.errorCode, j.message].filter(Boolean).join(": ") || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new TatumError(`Tatum ${res.status} on ${new URL(url).pathname}: ${detail}`, res.status, code);
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
