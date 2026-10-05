import { HDNodeWallet, Mnemonic } from "ethers";
import { TronWeb } from "tronweb";
import { describe, expect, it } from "vitest";
import {
  MAINNET_ACCOUNT_PATH,
  WrongMnemonicError,
  addressForPrivateKey,
  createHdSigner,
  generateGatewayWallets,
  signerFromPrivateKey,
} from "./keys";

// BIP-39 test vector mnemonic — public, holds nothing.
const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const OTHER = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const xpubAt = (mnemonic: string, path: string) =>
  HDNodeWallet.fromSeed(Mnemonic.fromPhrase(mnemonic).computeSeed()).derivePath(path).neuter().extendedKey;

describe("createHdSigner", () => {
  it("BSC mainnet path (coin 60) reproduces the well-known vector address", () => {
    const hd = createHdSigner("bsc", MNEMONIC, xpubAt(MNEMONIC, "m/44'/60'/0'/0"));
    expect(hd.path).toBe("m/44'/60'/0'/0");
    expect(hd.derive(0).address).toBe("0x9858effd232b4033e47d90003d41ec34ecaeda94");
  });

  it("picks Tatum's BSC TESTNET path (coin 1) when that is the xpub configured", () => {
    const hd = createHdSigner("bsc", MNEMONIC, xpubAt(MNEMONIC, "m/44'/1'/0'/0"));
    expect(hd.path).toBe("m/44'/1'/0'/0");
    const direct = HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/1'/0'/0/5");
    expect(hd.derive(5)).toEqual({ address: direct.address.toLowerCase(), privateKey: direct.privateKey.slice(2) });
  });

  it("TRON derivation agrees with TronWeb.fromMnemonic", () => {
    const hd = createHdSigner("tron", MNEMONIC, xpubAt(MNEMONIC, "m/44'/195'/0'/0"));
    for (const i of [0, 1, 42]) {
      const tw = TronWeb.fromMnemonic(MNEMONIC, `m/44'/195'/0'/0/${i}`);
      expect(hd.derive(i)).toEqual({ address: tw.address, privateKey: tw.privateKey.replace(/^0x/, "").toLowerCase() });
    }
  });

  it("refuses a mnemonic that does not reproduce the configured xpub", () => {
    expect(() => createHdSigner("tron", OTHER, xpubAt(MNEMONIC, "m/44'/195'/0'/0"))).toThrow(WrongMnemonicError);
    // A TRON-path xpub is not accepted for BSC either.
    expect(() => createHdSigner("bsc", MNEMONIC, xpubAt(MNEMONIC, "m/44'/195'/0'/0"))).toThrow(WrongMnemonicError);
  });
});

describe("generateGatewayWallets", () => {
  it("makes a 24-word phrase whose mainnet-path xpubs the sweep accepts, plus valid gas keys", () => {
    const w = generateGatewayWallets();
    expect(w.mnemonic.split(" ")).toHaveLength(24);
    expect(w.xpub.tron).toBe(xpubAt(w.mnemonic, MAINNET_ACCOUNT_PATH.tron));
    expect(w.xpub.bsc).toBe(xpubAt(w.mnemonic, MAINNET_ACCOUNT_PATH.bsc));
    // The sweep resolves BSC to the MAINNET path (coin 60) for these xpubs.
    expect(createHdSigner("bsc", w.mnemonic, w.xpub.bsc).path).toBe("m/44'/60'/0'/0");
    expect(w.sample.tron).toBe(TronWeb.fromMnemonic(w.mnemonic, "m/44'/195'/0'/0/1").address);
    expect(w.sample.bsc).toBe(HDNodeWallet.fromPhrase(w.mnemonic, undefined, "m/44'/60'/0'/0/1").address.toLowerCase());
    expect(w.gas.tron.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(w.gas.bsc).toEqual(signerFromPrivateKey("bsc", w.gas.bsc.privateKey));
  });

  it("never repeats", () => {
    const [a, b] = [generateGatewayWallets(), generateGatewayWallets()];
    expect(a.mnemonic).not.toBe(b.mnemonic);
    expect(a.gas.tron.privateKey).not.toBe(b.gas.tron.privateKey);
  });
});

describe("signerFromPrivateKey", () => {
  it("TRON and BSC addresses come from the same key bytes", () => {
    const tw = TronWeb.fromMnemonic(MNEMONIC, "m/44'/195'/0'/0/0");
    const key = tw.privateKey.replace(/^0x/, "");
    expect(signerFromPrivateKey("tron", `0x${key}`)).toEqual({ address: tw.address, privateKey: key.toLowerCase() });
    expect(addressForPrivateKey("bsc", key)).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("rejects malformed keys", () => {
    expect(() => signerFromPrivateKey("bsc", "abc")).toThrow(/32 bytes/);
  });
});
