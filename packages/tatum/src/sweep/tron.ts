import { utils as tronUtils } from "tronweb";
import type { TatumNetworkConfig } from "../config";
import { TatumError, tatumRequest } from "../http";
import { tronBase58ToHex } from "../tron";
import { SELECTOR_BALANCE_OF, SELECTOR_TRANSFER, addressWord, decodeUintWord, transferParams } from "./abi";
import type { Signer } from "./keys";
import type { ChainSweeper, SweepQuote, TxOutcome } from "./types";

/**
 * TRON sweep operations through Tatum's TRON node gateway (the testnet one is
 * Shasta — verified live against /v3/tron/info and TronGrid block heights).
 * The node BUILDS each transaction; we verify it (verifyBuiltTx) before
 * signing locally, then broadcast the signed JSON. Keys never leave this process.
 */

export const ENERGY_MARGIN_PCT = 125n;
/** A signed TRC-20 transfer is ~345 bytes; round up. */
export const SWEEP_TX_BYTES = 400n;
/** The gas wallet's own TRX transfer, priced as if its free bandwidth were used up. */
const TOPUP_TX_BYTES = 300n;

function gatewayBase(testnet: boolean): string {
  return testnet ? "https://tron-testnet.gateway.tatum.io" : "https://tron-mainnet.gateway.tatum.io";
}

interface BuiltTx {
  txID: string;
  raw_data: {
    contract: { type: string; parameter: { value: Record<string, unknown> } }[];
    fee_limit?: number;
  };
  raw_data_hex: string;
  visible?: boolean;
  signature?: string[];
}

export class UnsafeTransactionError extends Error {
  constructor(reason: string) {
    super(`Refusing to sign a node-built TRON transaction: ${reason}`);
    this.name = "UnsafeTransactionError";
  }
}

export type TronIntent =
  | { type: "TransferContract"; owner: string; to: string; amount: bigint }
  | { type: "TriggerSmartContract"; owner: string; contract: string; data: string; feeLimit: bigint };

/**
 * The node is untrusted: before signing we (1) rebuild the protobuf from the
 * JSON and require it to reproduce both raw_data_hex and txID (txCheck) — so
 * the JSON we inspect IS what gets signed — then (2) require every intent
 * field to equal what we asked for. Addresses compared as lowercase 41-hex.
 */
export function verifyBuiltTx(tx: unknown, intent: TronIntent): BuiltTx {
  const t = tx as BuiltTx;
  if (!t || typeof t.txID !== "string" || typeof t.raw_data_hex !== "string" || !t.raw_data?.contract) {
    throw new UnsafeTransactionError("malformed transaction");
  }
  if (t.signature?.length) throw new UnsafeTransactionError("already carries a signature");
  let consistent = false;
  try {
    consistent = tronUtils.transaction.txCheck(t as never);
  } catch {
    consistent = false;
  }
  if (!consistent) throw new UnsafeTransactionError("raw_data does not match raw_data_hex/txID");
  if (t.raw_data.contract.length !== 1) throw new UnsafeTransactionError("expected exactly one contract");
  const c = t.raw_data.contract[0]!;
  if (c.type !== intent.type) throw new UnsafeTransactionError(`type ${c.type}, expected ${intent.type}`);
  const v = c.parameter.value;
  const same = (field: string, expected: string) => {
    if (String(v[field] ?? "").toLowerCase() !== expected.toLowerCase()) {
      throw new UnsafeTransactionError(`${field} ${String(v[field])} != ${expected}`);
    }
  };
  same("owner_address", tronBase58ToHex(intent.owner));
  if (intent.type === "TransferContract") {
    same("to_address", tronBase58ToHex(intent.to));
    if (BigInt(String(v["amount"] ?? -1)) !== intent.amount) throw new UnsafeTransactionError(`amount ${String(v["amount"])} != ${intent.amount}`);
  } else {
    same("contract_address", tronBase58ToHex(intent.contract));
    same("data", intent.data);
    if (BigInt(String(v["call_value"] ?? 0)) !== 0n) throw new UnsafeTransactionError("call_value must be 0");
    if (v["call_token_value"] !== undefined || v["token_id"] !== undefined) throw new UnsafeTransactionError("unexpected TRC-10 value");
    if (BigInt(t.raw_data.fee_limit ?? -1) !== intent.feeLimit) throw new UnsafeTransactionError(`fee_limit ${t.raw_data.fee_limit} != ${intent.feeLimit}`);
  }
  return t;
}

const hexMessage = (m: unknown) => {
  const s = String(m ?? "");
  return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 ? Buffer.from(s, "hex").toString("utf8") : s;
};

export function createTronSweeper(
  cfg: TatumNetworkConfig,
  fetchImpl: typeof fetch = fetch,
  opts: { pollMs?: number } = {},
): ChainSweeper {
  const base = gatewayBase(cfg.testnet);
  const pollMs = opts.pollMs ?? 3_000;
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await tatumRequest<T>(fetchImpl, cfg.apiKey, `${base}${path}`, { method: "POST", body });
    if (res === null) throw new TatumError(`Empty TRON node response on ${path}`, null);
    return res;
  };
  const tokenHex = tronBase58ToHex(cfg.tokenContract);

  let params: Promise<Record<string, bigint>> | null = null;
  const chainParams = () =>
    (params ??= post<{ chainParameter?: { key: string; value?: number }[] }>("/wallet/getchainparameters", {}).then((r) => {
      const out: Record<string, bigint> = {};
      for (const p of r.chainParameter ?? []) out[p.key] = BigInt(p.value ?? 0);
      for (const k of ["getEnergyFee", "getTransactionFee", "getCreateNewAccountFeeInSystemContract", "getCreateAccountFee", "getFreeNetLimit"]) {
        if (out[k] === undefined) throw new TatumError(`TRON chain parameter ${k} missing`, null);
      }
      return out;
    }));

  const getAccount = (address: string) => post<{ address?: string; balance?: number }>("/wallet/getaccount", { address: tronBase58ToHex(address) });

  async function broadcast(signed: BuiltTx): Promise<string> {
    const res = await post<{ result?: boolean; txid?: string; code?: string; message?: string }>("/wallet/broadcasttransaction", signed);
    if (res.result !== true) throw new TatumError(`TRON broadcast rejected: ${res.code ?? "?"} ${hexMessage(res.message)}`, null);
    return signed.txID;
  }

  function sign(tx: BuiltTx, signer: Signer): BuiltTx {
    return tronUtils.crypto.signTransaction(signer.privateKey, tx as never) as unknown as BuiltTx;
  }

  return {
    network: "tron",
    nativeSymbol: "TRX",
    nativeDecimals: 6,

    async tokenBalance(address) {
      const res = await post<{ result?: { result?: boolean; message?: string }; constant_result?: string[] }>("/wallet/triggerconstantcontract", {
        owner_address: tronBase58ToHex(address),
        contract_address: tokenHex,
        function_selector: "balanceOf(address)",
        parameter: addressWord(tronBase58ToHex(address)),
      });
      if (res.result?.result !== true || !res.constant_result?.[0]) {
        throw new TatumError(`TRON ${SELECTOR_BALANCE_OF} call failed: ${hexMessage(res.result?.message)}`, null);
      }
      return decodeUintWord(res.constant_result[0]);
    },

    async nativeBalance(address) {
      return BigInt((await getAccount(address)).balance ?? 0);
    },

    async quoteSweep(from, to, amount): Promise<SweepQuote> {
      const p = await chainParams();
      const est = await post<{
        result?: { result?: boolean; message?: string };
        energy_used?: number;
        constant_result?: string[];
        transaction?: { ret?: { ret?: string }[] };
      }>(
        "/wallet/triggerconstantcontract",
        {
          owner_address: tronBase58ToHex(from),
          contract_address: tokenHex,
          function_selector: "transfer(address,uint256)",
          parameter: transferParams(tronBase58ToHex(to), amount),
        },
      );
      if (est.result?.result !== true) throw new TatumError(`TRON transfer simulation failed: ${hexMessage(est.result?.message)}`, null);
      // A revert (e.g. amount above the balance) still answers result:true;
      // only the simulated tx's ret says FAILED.
      if (est.transaction?.ret?.[0]?.ret === "FAILED") {
        throw new TatumError(`TRON transfer simulation reverted (balance moved?): ${hexMessage(est.result?.message)}`, null);
      }
      // The return value is deliberately NOT checked: mainnet USDT
      // (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t) returns false from transfer() even
      // when it succeeds (verified 2026-10-09 against TronGrid: a full-balance
      // transfer simulates with ret 0 and 64,285 energy; one unit more reverts).
      // Confirmation reads the receipt (SUCCESS), never the return value.
      const energy = BigInt(est.energy_used ?? 0);
      if (energy <= 0n) throw new TatumError("TRON transfer simulation reported no energy use", null);
      const feeLimit = ((energy * ENERGY_MARGIN_PCT + 99n) / 100n) * p["getEnergyFee"]!;

      const [account, resource] = await Promise.all([
        getAccount(from),
        post<{ freeNetLimit?: number; freeNetUsed?: number; NetLimit?: number; NetUsed?: number }>("/wallet/getaccountresource", {
          address: tronBase58ToHex(from),
        }),
      ]);
      const activated = Boolean(account.address);
      // An address activated by our top-up starts with the full daily free allowance.
      const freeBandwidth = activated
        ? BigInt((resource.freeNetLimit ?? 0) - (resource.freeNetUsed ?? 0) + (resource.NetLimit ?? 0) - (resource.NetUsed ?? 0))
        : p["getFreeNetLimit"]!;
      const bandwidthBurn = freeBandwidth >= SWEEP_TX_BYTES ? 0n : SWEEP_TX_BYTES * p["getTransactionFee"]!;

      const activation = activated ? 0n : p["getCreateNewAccountFeeInSystemContract"]! + p["getCreateAccountFee"]!;
      return {
        requiredNative: feeLimit + bandwidthBurn,
        topUpOverhead: activation + TOPUP_TX_BYTES * p["getTransactionFee"]!,
        feeLimit,
        note: `${energy} energy${bandwidthBurn ? " + bandwidth" : ""}${activated ? "" : ", activation"}`,
      };
    },

    async sendNative(signer, to, amount) {
      if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Bad TRX amount ${amount}`);
      const built = await post<BuiltTx & { Error?: string }>("/wallet/createtransaction", {
        owner_address: tronBase58ToHex(signer.address),
        to_address: tronBase58ToHex(to),
        amount: Number(amount),
      });
      if (built.Error) throw new TatumError(`TRON createtransaction: ${built.Error}`, null);
      const tx = verifyBuiltTx(built, { type: "TransferContract", owner: signer.address, to, amount });
      return broadcast(sign(tx, signer));
    },

    async sendToken(signer, to, amount, quote) {
      if (quote.feeLimit === undefined) throw new Error("TRON quote has no feeLimit");
      const parameter = transferParams(tronBase58ToHex(to), amount);
      const res = await post<{ result?: { result?: boolean; message?: string }; transaction?: BuiltTx }>("/wallet/triggersmartcontract", {
        owner_address: tronBase58ToHex(signer.address),
        contract_address: tokenHex,
        function_selector: "transfer(address,uint256)",
        parameter,
        fee_limit: Number(quote.feeLimit),
        call_value: 0,
      });
      if (res.result?.result !== true || !res.transaction) {
        throw new TatumError(`TRON triggersmartcontract: ${hexMessage(res.result?.message)}`, null);
      }
      const tx = verifyBuiltTx(res.transaction, {
        type: "TriggerSmartContract",
        owner: signer.address,
        contract: cfg.tokenContract,
        data: SELECTOR_TRANSFER + parameter,
        feeLimit: quote.feeLimit,
      });
      return broadcast(sign(tx, signer));
    },

    async waitForTx(txHash, timeoutMs = 120_000): Promise<TxOutcome> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const info = await post<{ blockNumber?: number; result?: string; receipt?: { result?: string } }>("/wallet/gettransactioninfobyid", { value: txHash });
        if (typeof info.blockNumber === "number") {
          const failed = info.result === "FAILED" || (info.receipt?.result !== undefined && info.receipt.result !== "SUCCESS");
          return failed ? "failed" : "success";
        }
        if (Date.now() + pollMs > deadline) return "pending";
        await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}
