import { HDNodeWallet, Mnemonic } from "ethers";
import { TronWeb } from "tronweb";
import { describe, expect, it } from "vitest";
import { WrongMnemonicError, addressForPrivateKey, createHdSigner, signerFromPrivateKey } from "./keys";

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
