import { TronWeb } from "tronweb";
import { logger } from "@asm/logger";
import type { ChainProvider, EventResolution, ExecutionResult, RawTrc20Row, TransferPage } from "../types";

/**
 * TronGrid REST endpoints this adapter calls, verified against live TronGrid
 * documentation (developers.tron.network) before writing this file — not
 * assumed. See the design doc's "TronGrid provider behavior" section for the
 * verification notes and sources; anything not directly confirmed there is
 * called out below as a VERIFICATION TASK rather than presented as settled.
 *
 * - GET  /v1/accounts/{address}/transactions/trc20  — discovery (fetchTransferPage)
 * - GET  /v1/transactions/{id}/events               — event index resolution (resolveTransferEvent)
 * - POST /walletsolidity/gettransactioninfobyid      — authoritative solidified state (getExecutionResult)
 * - POST /wallet/gettransactioninfobyid              — full-node cross-check for the reorg grace period
 * - decimals() via TronWeb's contract wrapper         — getTokenDecimals (avoids hand-rolling
 *   TRON's base58/hex address conversion and ABI decoding — a well-tested library's job, not this file's)
 */

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);

export interface TronProviderOptions {
  fullHost?: string;
  apiKey?: string;
}

function apiKeyHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { "TRON-PRO-API-KEY": apiKey } : {};
}

/**
 * Converts a TRON base58 address (e.g. "TVJ6...") to the 0x-prefixed,
 * 20-byte hex form TronGrid's decoded event parameters use for
 * address-typed values (verified against a real Nile transaction — see the
 * comment above resolveTransferEvent's candidate filter). TronWeb.address.toHex
 * is a static, offline utility — no network call, no private key, no
 * account lookup — it returns the TRON-prefixed 21-byte hex ("41" + 20
 * bytes); this strips that version byte and adds "0x" to match the format
 * actually observed in event data.
 */
function toEvmHexAddress(base58Address: string): string {
  const tronHex = TronWeb.address.toHex(base58Address).toLowerCase();
  return `0x${tronHex.slice(2)}`;
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; body: unknown } | { ok: false; retryable: boolean; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // Network-level failure (timeout, DNS, connection reset) — always retryable.
    return { ok: false, retryable: true, message: err instanceof Error ? err.message : "network error" };
  }

  if (!res.ok) {
    return {
      ok: false,
      retryable: RETRYABLE_HTTP_STATUS.has(res.status),
      message: `HTTP ${res.status}`,
    };
  }

  try {
    return { ok: true, body: await res.json() };
  } catch {
    // Malformed JSON from an otherwise-200 response — never guessed at.
    return { ok: false, retryable: true, message: "malformed JSON response" };
  }
}

export function createTronProvider(opts: TronProviderOptions = {}): ChainProvider {
  const fullHost = opts.fullHost ?? "https://api.trongrid.io";
  const headers = { "Content-Type": "application/json", ...apiKeyHeaders(opts.apiKey) };
  const tronWeb = new TronWeb({ fullHost, headers: apiKeyHeaders(opts.apiKey) });

  return {
    async fetchTransferPage(params): Promise<TransferPage> {
      const query = new URLSearchParams({
        only_to: "true",
        contract_address: params.tokenContract,
        order_by: "block_timestamp,asc",
        min_timestamp: String(params.minTimestampMs),
        max_timestamp: String(params.maxTimestampMs),
        limit: "200",
      });
      if (params.fingerprint) query.set("fingerprint", params.fingerprint);

      const url = `${fullHost}/v1/accounts/${params.receivingAddress}/transactions/trc20?${query.toString()}`;
      const result = await fetchJson(url, { headers });
      if (!result.ok) {
        logger.warn(
          { evt: "chain.provider.error", op: "fetchTransferPage", retryable: result.retryable, reason: result.message },
          "TronGrid transfer listing call failed",
        );
        // The caller treats a thrown error here as "this page failed, do not
        // advance the checkpoint" — see the design doc's pagination section.
        throw new Error(`fetchTransferPage: ${result.message}`);
      }

      const body = result.body as {
        data?: Array<{
          transaction_id?: unknown;
          from?: unknown;
          to?: unknown;
          value?: unknown;
          token_info?: { address?: unknown; decimals?: unknown };
          block_timestamp?: unknown;
        }>;
        meta?: { fingerprint?: unknown };
      };

      const rows: RawTrc20Row[] = [];
      for (const row of body.data ?? []) {
        if (
          typeof row.transaction_id !== "string" ||
          typeof row.from !== "string" ||
          typeof row.to !== "string" ||
          typeof row.value !== "string" ||
          typeof row.token_info?.address !== "string" ||
          typeof row.token_info?.decimals !== "number" ||
          typeof row.block_timestamp !== "number"
        ) {
          logger.warn(
            { evt: "chain.credit.malformed_row", op: "fetchTransferPage", raw: row },
            "skipping a malformed TronGrid transfer row",
          );
          continue;
        }
        rows.push({
          transactionId: row.transaction_id,
          fromAddress: row.from,
          toAddress: row.to,
          rawValue: row.value,
          tokenContract: row.token_info.address,
          tokenDecimals: row.token_info.decimals,
          blockTimestampMs: row.block_timestamp,
        });
      }

      const fingerprint = typeof body.meta?.fingerprint === "string" ? body.meta.fingerprint : null;
      return { rows, nextFingerprint: fingerprint };
    },

    async resolveTransferEvent(params): Promise<EventResolution> {
      const url = `${fullHost}/v1/transactions/${params.txHash}/events`;
      const result = await fetchJson(url, { headers });
      if (!result.ok) {
        return { kind: "provider_error", retryable: result.retryable, message: result.message };
      }

      const body = result.body as {
        data?: Array<{
          event_name?: unknown;
          contract_address?: unknown;
          event_index?: unknown;
          // VERIFIED against a real Nile testnet transaction (not assumed):
          // the decoded Transfer event's address-typed parameters ("from",
          // "to") come back as 0x-prefixed 20-byte hex — the same raw bytes
          // as a TRON address but WITHOUT the 0x41 TRON version byte and
          // WITHOUT base58 encoding — even though the top-level
          // `contract_address` field on this same response is base58. The
          // non-address `value` parameter is a plain decimal string, as
          // expected. See toEvmHexAddress() below for the exact conversion
          // this requires.
          result?: { from?: unknown; to?: unknown; value?: unknown };
          block_number?: unknown;
        }>;
      };

      const expectedToHex = toEvmHexAddress(params.expectedToAddress);
      const candidates = (body.data ?? []).filter(
        (e) =>
          e.event_name === "Transfer" &&
          e.contract_address === params.expectedTokenContract &&
          typeof e.result?.to === "string" &&
          e.result.to.toLowerCase() === expectedToHex &&
          e.result?.value === params.expectedRawAmount.toString() &&
          typeof e.event_index === "number" &&
          typeof e.block_number === "number",
      );

      if (candidates.length === 0) return { kind: "not_found" };
      if (candidates.length > 1) {
        return {
          kind: "ambiguous",
          candidateEventIndexes: candidates.map((c) => c.event_index as number),
        };
      }
      const winner = candidates[0]!;
      return {
        kind: "resolved",
        eventIndex: winner.event_index as number,
        // Confirmed present on THIS endpoint's response (unlike the TRC-20
        // listing endpoint, which only documents block_timestamp) — verified
        // against live TronGrid docs, not invented.
        blockNumber: BigInt(winner.block_number as number),
      };
    },

    async getExecutionResult(txHash: string): Promise<ExecutionResult> {
      const solidityUrl = `${fullHost}/walletsolidity/gettransactioninfobyid`;
      const solidityResult = await fetchJson(solidityUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ value: txHash }),
      });
      if (!solidityResult.ok) {
        return { state: "provider_error", retryable: solidityResult.retryable, message: solidityResult.message };
      }

      const solidityBody = solidityResult.body as { id?: unknown; receipt?: { result?: unknown } };
      // TronGrid's solidity-node variant returns an empty object until the
      // transaction is solidified — the absence of `id` is that signal, not
      // an error (verified: the endpoint is documented to query "confirmed
      // and finalized blockchain state" only).
      if (typeof solidityBody.id !== "string") {
        const fullNodeUrl = `${fullHost}/wallet/gettransactioninfobyid`;
        const fullNodeResult = await fetchJson(fullNodeUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ value: txHash }),
        });
        if (!fullNodeResult.ok) {
          // Can't determine the full-node cross-check right now — report as
          // not-yet-solidified rather than guessing at "missing everywhere".
          return { state: "not_yet_solidified" };
        }
        const fullNodeBody = fullNodeResult.body as { id?: unknown };
        return { state: "not_found_on_solidity_node", alsoMissingOnFullNode: typeof fullNodeBody.id !== "string" };
      }

      // Real enum values per the TRON protobuf spec (Result.contractResult):
      // only "SUCCESS" is credit-eligible; REVERT/OUT_OF_ENERGY/OUT_OF_TIME/
      // TRANSFER_FAILED/etc. are all failures.
      const success = solidityBody.receipt?.result === "SUCCESS";
      return { state: "solidified", success };
    },

    async getTokenDecimals(tokenContract: string): Promise<number> {
      // TronWeb's underlying triggerconstantcontract RPC requires an
      // owner_address on every call, including a pure read-only constant
      // call like decimals() — it's used only as simulation context, never
      // for signing or fees, and setAddress() explicitly never signs
      // anything (verified: TronWeb docs describe it as setting "the
      // default address used across all TronWeb APIs without signing any
      // transactions"). No real account, private key, or funding is
      // required. decimals() is a plain view function with no access
      // control — its result never depends on the caller — so the token
      // contract's own address is a safe, always-available choice here,
      // with no new configuration and no invented placeholder address.
      tronWeb.setAddress(tokenContract);
      const contract = await tronWeb.contract().at(tokenContract);
      const raw: unknown = await contract.decimals().call();
      const decimals = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(decimals) || decimals < 0) {
        throw new Error(`getTokenDecimals: unexpected decimals() result for ${tokenContract}: ${String(raw)}`);
      }
      return decimals;
    },
  };
}
