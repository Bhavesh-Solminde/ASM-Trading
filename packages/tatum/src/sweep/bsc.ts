import { SigningKey, Transaction } from "ethers";
import type { TatumNetworkConfig } from "../config";
import { TATUM_API_BASE, TatumError, tatumRequest, tatumRpc } from "../http";
import { SELECTOR_TRANSFER, transferParams } from "./abi";
import type { Signer } from "./keys";
import type { ChainSweeper, SweepQuote, TxOutcome } from "./types";

/**
 * BSC sweep operations. Transactions are built AND signed locally (legacy
 * type-0, chain id pinned), then broadcast raw through Tatum's RPC gateway;
 * the only thing taken from the RPC is nonce, gas price and gas estimate —
 * each sanity-checked.
 */

export const GAS_MARGIN_PCT = 125n;
const NATIVE_TRANSFER_GAS = 21_000n;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

function gatewayUrl(testnet: boolean): string {
  return testnet ? "https://bsc-testnet.gateway.tatum.io/" : "https://bsc-mainnet.gateway.tatum.io/";
}

export function createBscSweeper(
  cfg: TatumNetworkConfig,
  fetchImpl: typeof fetch = fetch,
  opts: { pollMs?: number; maxGasPriceWei?: bigint } = {},
): ChainSweeper {
  const url = gatewayUrl(cfg.testnet);
  const rpc = <T>(method: string, params: unknown[]) => tatumRpc<T>(fetchImpl, cfg.apiKey, url, method, params);
  const expectedChainId = cfg.testnet ? 97n : 56n;
  const maxGasPrice = opts.maxGasPriceWei ?? 10_000_000_000n; // 10 gwei
  const pollMs = opts.pollMs ?? 3_000;
  const token = cfg.tokenContract.toLowerCase();

  let chainChecked: Promise<void> | null = null;
  const checkChain = () =>
    (chainChecked ??= rpc<string>("eth_chainId", []).then((id) => {
      if (BigInt(id) !== expectedChainId) {
        throw new TatumError(`BSC gateway reports chain ${BigInt(id)}, expected ${expectedChainId}. Refusing to sign.`, null);
      }
    }));

  async function gasPrice(): Promise<bigint> {
    const p = BigInt(await rpc<string>("eth_gasPrice", []));
    if (p <= 0n || p > maxGasPrice) throw new TatumError(`BSC gas price ${p} wei is outside (0, ${maxGasPrice}]. Refusing.`, null);
    return p;
  }

  async function signAndSend(signer: Signer, fields: { to: string; value: bigint; data: string; gasLimit: bigint; gasPrice: bigint }): Promise<string> {
    await checkChain();
    const nonce = Number(BigInt(await rpc<string>("eth_getTransactionCount", [signer.address, "pending"])));
    const tx = Transaction.from({
      type: 0,
      chainId: expectedChainId,
      nonce,
      gasPrice: fields.gasPrice,
      gasLimit: fields.gasLimit,
      to: fields.to,
      value: fields.value,
      data: fields.data,
    });
    tx.signature = new SigningKey(`0x${signer.privateKey}`).sign(tx.unsignedHash);
    if (tx.from?.toLowerCase() !== signer.address.toLowerCase()) throw new Error("Signed BSC tx recovers to the wrong sender.");
    const hash = await rpc<string>("eth_sendRawTransaction", [tx.serialized]);
    if (hash?.toLowerCase() !== tx.hash!.toLowerCase()) {
      throw new TatumError(`BSC gateway returned hash ${hash}, expected ${tx.hash}.`, null);
    }
    return tx.hash!.toLowerCase();
  }

  const assertAddress = (a: string) => {
    if (!EVM_ADDRESS.test(a.toLowerCase())) throw new Error(`Not a BSC address: ${a}`);
    return a.toLowerCase();
  };

  return {
    network: "bsc",
    nativeSymbol: "BNB",
    nativeDecimals: 18,

    // Tatum's free plan refuses eth_call (verified live: -16401 "paid plans
    // only"), so balanceOf goes through Tatum's REST token-balance endpoint,
    // which returns the raw base-unit balance.
    async tokenBalance(address) {
      const res = await tatumRequest<{ balance?: string }>(
        fetchImpl,
        cfg.apiKey,
        `${TATUM_API_BASE}/v3/blockchain/token/balance/BSC/${token}/${assertAddress(address)}`,
      );
      const raw = res?.balance;
      if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) throw new TatumError(`Tatum BSC token balance unreadable: ${JSON.stringify(res)}`, null);
      return BigInt(raw);
    },

    async nativeBalance(address) {
      return BigInt(await rpc<string>("eth_getBalance", [assertAddress(address), "latest"]));
    },

    async quoteSweep(from, to, amount): Promise<SweepQuote> {
      const price = await gasPrice();
      const estimate = BigInt(
        await rpc<string>("eth_estimateGas", [
          { from: assertAddress(from), to: token, value: "0x0", data: `0x${SELECTOR_TRANSFER}${transferParams(assertAddress(to), amount)}` },
        ]),
      );
      if (estimate < NATIVE_TRANSFER_GAS || estimate > 500_000n) throw new TatumError(`Implausible BSC gas estimate ${estimate}.`, null);
      const gasLimit = (estimate * GAS_MARGIN_PCT + 99n) / 100n;
      return {
        requiredNative: gasLimit * price,
        topUpOverhead: NATIVE_TRANSFER_GAS * price,
        gasLimit,
        gasPrice: price,
        note: `${estimate} gas @ ${price} wei`,
      };
    },

    async sendNative(signer, to, amount) {
      if (amount <= 0n) throw new Error(`Bad BNB amount ${amount}`);
      return signAndSend(signer, { to: assertAddress(to), value: amount, data: "0x", gasLimit: NATIVE_TRANSFER_GAS, gasPrice: await gasPrice() });
    },

    async sendToken(signer, to, amount, quote) {
      if (quote.gasLimit === undefined || quote.gasPrice === undefined) throw new Error("BSC quote has no gas settings");
      return signAndSend(signer, {
        to: token,
        value: 0n,
        data: `0x${SELECTOR_TRANSFER}${transferParams(assertAddress(to), amount)}`,
        gasLimit: quote.gasLimit,
        gasPrice: quote.gasPrice,
      });
    },

    async waitForTx(txHash, timeoutMs = 120_000): Promise<TxOutcome> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const receipt = await rpc<{ status?: string; blockNumber?: string } | null>("eth_getTransactionReceipt", [txHash]);
        if (receipt?.blockNumber) return BigInt(receipt.status ?? "0x0") === 1n ? "success" : "failed";
        if (Date.now() + pollMs > deadline) return "pending";
        await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}
