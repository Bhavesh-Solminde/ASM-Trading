import { describe, expect, it } from "vitest";
import transferFx from "../__fixtures__/tron-build-transfer.json" with { type: "json" };
import transferOtherFx from "../__fixtures__/tron-build-transfer-other.json" with { type: "json" };
import triggerFx from "../__fixtures__/tron-build-trigger.json" with { type: "json" };
import type { TatumNetworkConfig } from "../config";
import { fakeFetch, type FakeRoutes } from "../test-utils";
import { SELECTOR_TRANSFER, transferParams } from "./abi";
import { UnsafeTransactionError, createTronSweeper, verifyBuiltTx } from "./tron";
import { tronBase58ToHex } from "../tron";

// Unsigned transactions built by Tatum's Shasta node (captured live).
const OWNER = "TVF2Mp9QY7FEGTnr3DBpFLobA6jguHyMvi";
const DEPOSIT = "TUczayvfGM8vbKEhncuoG6PD7BB4GdHRoT";
const ATTACKER = "TSE6FNmm11UyZzSTnsYgpHPxxBsHTH7c58";
const TOKEN = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const TREASURY = "TL5cUNhJjPSmyZVDncznin7FrSTtea6zUG";
const TRIGGER_DATA = SELECTOR_TRANSFER + transferParams(tronBase58ToHex(TREASURY), 25_000_000n);

const CFG: TatumNetworkConfig = {
  network: "tron",
  apiKey: "t-test",
  testnet: true,
  xpub: "xpub-tron",
  tokenContract: TOKEN,
  tokenDecimals: 6,
  webhookUrl: null,
  hmacSecret: null,
};
// Any key works for flow tests; the node-built tx only names the owner.
const SIGNER = { address: OWNER, privateKey: "11".repeat(32) };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const transferIntent = { type: "TransferContract" as const, owner: OWNER, to: DEPOSIT, amount: 7_500_000n };
const triggerIntent = { type: "TriggerSmartContract" as const, owner: OWNER, contract: TOKEN, data: TRIGGER_DATA, feeLimit: 1_630_625n };

describe("verifyBuiltTx", () => {
  it("accepts node-built transactions that match the intent exactly", () => {
    expect(verifyBuiltTx(clone(transferFx), transferIntent).txID).toBe(transferFx.txID);
    expect(verifyBuiltTx(clone(triggerFx.transaction), triggerIntent).txID).toBe(triggerFx.transaction.txID);
  });

  it("rejects JSON edited without re-encoding (raw_data_hex/txID no longer match)", () => {
    const tx = clone(transferFx);
    tx.raw_data.contract[0]!.parameter.value.amount = 1;
    expect(() => verifyBuiltTx(tx, { ...transferIntent, amount: 1n })).toThrow(/does not match raw_data_hex/);
  });

  it("rejects a self-consistent transaction to a different recipient", () => {
    expect(() => verifyBuiltTx(clone(transferOtherFx), transferIntent)).toThrow(/to_address/);
  });

  it("rejects a wrong amount, owner, fee limit, call data or contract", () => {
    expect(() => verifyBuiltTx(clone(transferFx), { ...transferIntent, amount: 7_500_001n })).toThrow(/amount/);
    expect(() => verifyBuiltTx(clone(transferFx), { ...transferIntent, owner: DEPOSIT })).toThrow(/owner_address/);
    expect(() => verifyBuiltTx(clone(triggerFx.transaction), { ...triggerIntent, feeLimit: 1n })).toThrow(/fee_limit/);
    const otherAmount = SELECTOR_TRANSFER + transferParams(tronBase58ToHex(TREASURY), 1n);
    expect(() => verifyBuiltTx(clone(triggerFx.transaction), { ...triggerIntent, data: otherAmount })).toThrow(/data/);
    expect(() => verifyBuiltTx(clone(triggerFx.transaction), { ...triggerIntent, contract: TREASURY })).toThrow(/contract_address/);
    expect(() => verifyBuiltTx(clone(transferFx), { ...triggerIntent })).toThrow(/type TransferContract/);
  });

  it("rejects an already-signed or malformed transaction", () => {
    expect(() => verifyBuiltTx({ ...clone(transferFx), signature: ["ab"] }, transferIntent)).toThrow(UnsafeTransactionError);
    expect(() => verifyBuiltTx({ txID: "x" }, transferIntent)).toThrow(/malformed/);
  });
});

const PARAMS = {
  chainParameter: [
    { key: "getEnergyFee", value: 100 },
    { key: "getTransactionFee", value: 1000 },
    { key: "getCreateNewAccountFeeInSystemContract", value: 1_000_000 },
    { key: "getCreateAccountFee", value: 100_000 },
    { key: "getFreeNetLimit", value: 600 },
  ],
};

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    "POST /wallet/getchainparameters": PARAMS,
    "POST /wallet/triggerconstantcontract": (body: unknown) => {
      const b = body as { function_selector: string };
      return b.function_selector === "balanceOf(address)"
        ? { result: { result: true }, constant_result: [(25_000_000n).toString(16).padStart(64, "0")] }
        : { result: { result: true }, energy_used: 13045, constant_result: ["1".padStart(64, "0")] };
    },
    "POST /wallet/getaccount": {},
    "POST /wallet/getaccountresource": {},
    ...extra,
  };
}

describe("createTronSweeper", () => {
  it("talks to Tatum's Shasta node gateway with the API key", async () => {
    const f = fakeFetch(routes());
    expect(await createTronSweeper(CFG, f.fetch).tokenBalance(DEPOSIT)).toBe(25_000_000n);
    expect(f.calls[0]!.url).toBe("https://tron-testnet.gateway.tatum.io/wallet/triggerconstantcontract");
    expect(f.calls[0]!.headers["x-api-key"]).toBe("t-test");
  });

  it("quotes a fresh (unactivated) address: energy fee limit only, activation charged to the gas wallet", async () => {
    const q = await createTronSweeper(CFG, fakeFetch(routes()).fetch).quoteSweep(DEPOSIT, TREASURY, 25_000_000n);
    // ceil(13045 × 1.25) = 16307 energy × 100 sun
    expect(q.feeLimit).toBe(1_630_700n);
    expect(q.requiredNative).toBe(1_630_700n); // a new account gets 600 free bandwidth
    expect(q.topUpOverhead).toBe(1_000_000n + 100_000n + 300n * 1000n);
  });

  it("quotes a mainnet-USDT transfer whose simulation returns false (USDT's transfer() returns false on success)", async () => {
    const f = fakeFetch(
      routes({
        "POST /wallet/triggerconstantcontract": { result: { result: true }, energy_used: 64285, constant_result: ["0".padStart(64, "0")] },
      }),
    );
    const q = await createTronSweeper(CFG, f.fetch).quoteSweep(DEPOSIT, TREASURY, 10_000_000n);
    // ceil(64285 × 1.25) = 80357 energy × 100 sun
    expect(q.feeLimit).toBe(8_035_700n);
  });

  it("refuses to quote a transfer whose simulation reverts (result:true, tx ret FAILED)", async () => {
    const f = fakeFetch(
      routes({
        "POST /wallet/triggerconstantcontract": {
          result: { result: true, message: "REVERT opcode executed" },
          energy_used: 8624,
          constant_result: [""],
          transaction: { ret: [{ ret: "FAILED" }] },
        },
      }),
    );
    await expect(createTronSweeper(CFG, f.fetch).quoteSweep(DEPOSIT, TREASURY, 10_000_001n)).rejects.toThrow(/reverted/);
  });

  it("adds a bandwidth burn when an activated address has used its free bandwidth", async () => {
    const f = fakeFetch(
      routes({
        "POST /wallet/getaccount": { address: tronBase58ToHex(DEPOSIT), balance: 5 },
        "POST /wallet/getaccountresource": { freeNetLimit: 600, freeNetUsed: 500 },
      }),
    );
    const q = await createTronSweeper(CFG, f.fetch).quoteSweep(DEPOSIT, TREASURY, 25_000_000n);
    expect(q.requiredNative).toBe(1_630_700n + 400n * 1000n);
    expect(q.topUpOverhead).toBe(300n * 1000n); // already activated
    expect(await createTronSweeper(CFG, f.fetch).nativeBalance(DEPOSIT)).toBe(5n);
  });

  it("never signs or broadcasts a node-built tx that pays someone else", async () => {
    const f = fakeFetch(routes({ "POST /wallet/createtransaction": clone(transferOtherFx), "POST /wallet/broadcasttransaction": { result: true } }));
    await expect(createTronSweeper(CFG, f.fetch).sendNative(SIGNER, DEPOSIT, 7_500_000n)).rejects.toThrow(UnsafeTransactionError);
    expect(f.calls.some((c) => c.url.endsWith("/broadcasttransaction"))).toBe(false);
  });

  it("signs and broadcasts a verified transfer and returns its txID", async () => {
    const f = fakeFetch(routes({ "POST /wallet/createtransaction": clone(transferFx), "POST /wallet/broadcasttransaction": { result: true, txid: transferFx.txID } }));
    expect(await createTronSweeper(CFG, f.fetch).sendNative(SIGNER, DEPOSIT, 7_500_000n)).toBe(transferFx.txID);
    const sent = f.calls.find((c) => c.url.endsWith("/broadcasttransaction"))!.body as { txID: string; signature: string[] };
    expect(sent.txID).toBe(transferFx.txID);
    expect(sent.signature).toHaveLength(1);
  });

  it("sends the token transfer with the quoted fee limit", async () => {
    const f = fakeFetch(routes({ "POST /wallet/triggersmartcontract": clone(triggerFx), "POST /wallet/broadcasttransaction": { result: true } }));
    const quote = { requiredNative: 0n, topUpOverhead: 0n, feeLimit: 1_630_625n, note: "" };
    expect(await createTronSweeper(CFG, f.fetch).sendToken(SIGNER, TREASURY, 25_000_000n, quote)).toBe(triggerFx.transaction.txID);
    const req = f.calls.find((c) => c.url.endsWith("/triggersmartcontract"))!.body as Record<string, unknown>;
    expect(req).toMatchObject({ fee_limit: 1_630_625, call_value: 0, function_selector: "transfer(address,uint256)" });
  });

  it("surfaces a rejected broadcast with the node's decoded message", async () => {
    const f = fakeFetch(
      routes({
        "POST /wallet/createtransaction": clone(transferFx),
        "POST /wallet/broadcasttransaction": { result: false, code: "SIGERROR", message: Buffer.from("bad sig").toString("hex") },
      }),
    );
    await expect(createTronSweeper(CFG, f.fetch).sendNative(SIGNER, DEPOSIT, 7_500_000n)).rejects.toThrow(/SIGERROR bad sig/);
  });

  it("waitForTx reads the receipt: SUCCESS, FAILED/REVERT, or still pending", async () => {
    const outcome = async (info: unknown) =>
      createTronSweeper(CFG, fakeFetch(routes({ "POST /wallet/gettransactioninfobyid": info })).fetch, { pollMs: 1 }).waitForTx("ab".repeat(32), 0);
    expect(await outcome({ blockNumber: 1, receipt: { result: "SUCCESS" } })).toBe("success");
    expect(await outcome({ blockNumber: 1, receipt: { net_usage: 268 } })).toBe("success"); // plain TRX transfer
    expect(await outcome({ blockNumber: 1, receipt: { result: "REVERT" } })).toBe("failed");
    expect(await outcome({ blockNumber: 1, result: "FAILED", receipt: {} })).toBe("failed");
    expect(await outcome({})).toBe("pending");
  });
});
