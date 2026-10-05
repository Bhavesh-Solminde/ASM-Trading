import { HDNodeWallet, Mnemonic, computeAddress, randomBytes } from "ethers";
import type { GatewayNetwork } from "../config";
import { tronHexToBase58 } from "../tron";

/**
 * Local key handling for the OFFLINE sweep tool. Never imported by the web
 * app or the engine — private keys exist only on the owner's machine.
 */

export interface Signer {
  /** TRON base58 (T…) / BSC lowercase 0x hex — the same form Deposit.receivingAddress stores. */
  address: string;
  /** 32-byte hex, no 0x. */
  privateKey: string;
}

/**
 * Account-level paths (…/0, the level Tatum's xpubs sit at) to try, per
 * network. Tatum derives EVM chains at coin type 1 on TESTNET and 60 on
 * mainnet — verified live: the testnet BSC xpub only matches m/44'/1'/0'/0.
 * TRON is 195 on both. The path is never assumed: createHdSigner picks the
 * one whose xpub equals the configured TATUM_*_XPUB.
 */
export const ACCOUNT_PATHS: Record<GatewayNetwork, readonly string[]> = {
  tron: ["m/44'/195'/0'/0"],
  bsc: ["m/44'/60'/0'/0", "m/44'/1'/0'/0"],
};

export class WrongMnemonicError extends Error {
  constructor(network: GatewayNetwork) {
    super(
      `The ${network} mnemonic does not produce the configured TATUM_${network.toUpperCase()}_XPUB ` +
        `at any of ${ACCOUNT_PATHS[network].join(", ")}. Wrong wallet file? Nothing was sent.`,
    );
    this.name = "WrongMnemonicError";
  }
}

const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

/** The deposit-address form of the address controlled by `privateKey`. */
export function addressForPrivateKey(network: GatewayNetwork, privateKey: string): string {
  if (!PRIVATE_KEY.test(privateKey)) throw new Error("Private key must be 32 bytes of hex.");
  // TRON and EVM share secp256k1 + keccak: same 20 bytes, TRON adds the 0x41 prefix.
  const evm = computeAddress(`0x${privateKey.replace(/^0x/, "")}`).toLowerCase();
  return network === "tron" ? tronHexToBase58(`41${evm.slice(2)}`) : evm;
}

export function signerFromPrivateKey(network: GatewayNetwork, privateKey: string): Signer {
  const key = privateKey.replace(/^0x/, "").toLowerCase();
  return { address: addressForPrivateKey(network, key), privateKey: key };
}

export interface HdSigner {
  /** The account path whose xpub matched. */
  path: string;
  derive(index: number): Signer;
}

/** Tatum's MAINNET account paths — what generateGatewayWallets derives its xpubs at. */
export const MAINNET_ACCOUNT_PATH: Record<GatewayNetwork, string> = {
  tron: "m/44'/195'/0'/0",
  bsc: "m/44'/60'/0'/0",
};

export interface GeneratedGatewayWallets {
  /** 24 words; ONE phrase backs both chains (different account paths). */
  mnemonic: string;
  xpub: Record<GatewayNetwork, string>;
  /** Fresh sweep gas-wallet keys, one per chain. */
  gas: Record<GatewayNetwork, Signer>;
  /** Deposit address at index 1, re-derived through createHdSigner (proves the sweep can sign for it). */
  sample: Record<GatewayNetwork, string>;
}

/** A new deposit HD wallet (256-bit entropy) plus sweep gas keys. In memory only — the caller decides where it goes. */
export function generateGatewayWallets(): GeneratedGatewayWallets {
  const mnemonic = Mnemonic.fromEntropy(randomBytes(32)).phrase;
  const root = HDNodeWallet.fromSeed(Mnemonic.fromPhrase(mnemonic).computeSeed());
  const xpub = {
    tron: root.derivePath(MAINNET_ACCOUNT_PATH.tron).neuter().extendedKey,
    bsc: root.derivePath(MAINNET_ACCOUNT_PATH.bsc).neuter().extendedKey,
  };
  const key = () => Buffer.from(randomBytes(32)).toString("hex");
  return {
    mnemonic,
    xpub,
    gas: { tron: signerFromPrivateKey("tron", key()), bsc: signerFromPrivateKey("bsc", key()) },
    sample: {
      tron: createHdSigner("tron", mnemonic, xpub.tron).derive(1).address,
      bsc: createHdSigner("bsc", mnemonic, xpub.bsc).derive(1).address,
    },
  };
}

/** Derives deposit-address keys from `mnemonic`, refusing unless it reproduces `xpub`. */
export function createHdSigner(network: GatewayNetwork, mnemonic: string, xpub: string): HdSigner {
  const root = HDNodeWallet.fromSeed(Mnemonic.fromPhrase(mnemonic.trim().replace(/\s+/g, " ")).computeSeed());
  for (const path of ACCOUNT_PATHS[network]) {
    const account = root.derivePath(path);
    if (account.neuter().extendedKey !== xpub.trim()) continue;
    return {
      path,
      derive(index) {
        if (!Number.isInteger(index) || index < 0) throw new Error(`Bad derivation index ${index}.`);
        return signerFromPrivateKey(network, account.deriveChild(index).privateKey);
      },
    };
  }
  throw new WrongMnemonicError(network);
}
