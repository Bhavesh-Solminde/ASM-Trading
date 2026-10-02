import { afterEach, describe, expect, it, vi } from "vitest";

const { decimalsCall, setAddressCall } = vi.hoisted(() => ({ decimalsCall: vi.fn(), setAddressCall: vi.fn() }));

// Known-real base58 -> hex mapping (verified earlier against the actual
// TronWeb library, not invented), for the one address this test file ever
// runs through resolveTransferEvent's real base58->EVM-hex conversion.
// Real TronWeb.address.toHex throws on anything else; this mock does too,
// so a test accidentally using an unmapped address fails loudly instead of
// silently passing.
const KNOWN_HEX: Record<string, string> = {
  TVJ6njG5EpUwJt4N9xjTrqU5za78cgadS2: "41d3fd1b6f3f3a86303e2925844456c49876c4561f",
};

vi.mock("tronweb", () => ({
  TronWeb: class {
    static address = {
      toHex: (address: string) => {
        const hex = KNOWN_HEX[address];
        if (!hex) throw new Error("Invalid address provided");
        return hex;
      },
    };
    setAddress(address: string) {
      setAddressCall(address);
    }
    contract() {
      return { at: async () => ({ decimals: () => ({ call: decimalsCall }) }) };
    }
  },
}));

const { createTronProvider } = await import("./tron");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  decimalsCall.mockReset();
  setAddressCall.mockReset();
});

describe("fetchTransferPage", () => {
  it("normalizes a well-formed TronGrid TRC-20 listing response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              transaction_id: "tx1",
              from: "TFrom111",
              to: "TTo111",
              value: "1000000",
              token_info: { address: "TContract111", decimals: 6 },
              block_timestamp: 1_700_000_000_000,
            },
          ],
          meta: { fingerprint: "abc" },
        }),
      ),
    );

    const provider = createTronProvider();
    const page = await provider.fetchTransferPage({
      receivingAddress: "TReceiving111",
      tokenContract: "TContract111",
      minTimestampMs: 0,
      maxTimestampMs: 1,
      fingerprint: null,
    });

    expect(page.nextFingerprint).toBe("abc");
    expect(page.rows).toEqual([
      {
        transactionId: "tx1",
        fromAddress: "TFrom111",
        toAddress: "TTo111",
        rawValue: "1000000",
        tokenContract: "TContract111",
        tokenDecimals: 6,
        blockTimestampMs: 1_700_000_000_000,
      },
    ]);
  });

  it("skips a malformed row (missing/wrong-typed fields) rather than throwing or guessing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [{ transaction_id: "tx1" /* missing everything else */ }],
          meta: {},
        }),
      ),
    );

    const provider = createTronProvider();
    const page = await provider.fetchTransferPage({
      receivingAddress: "TReceiving111",
      tokenContract: "TContract111",
      minTimestampMs: 0,
      maxTimestampMs: 1,
      fingerprint: null,
    });
    expect(page.rows).toEqual([]);
    expect(page.nextFingerprint).toBeNull();
  });

  it("throws on a 500 so the caller never advances its checkpoint past a failed page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const provider = createTronProvider();
    await expect(
      provider.fetchTransferPage({
        receivingAddress: "TReceiving111",
        tokenContract: "TContract111",
        minTimestampMs: 0,
        maxTimestampMs: 1,
        fingerprint: null,
      }),
    ).rejects.toThrow();
  });

  it("throws on malformed (non-JSON) response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    );
    const provider = createTronProvider();
    await expect(
      provider.fetchTransferPage({
        receivingAddress: "TReceiving111",
        tokenContract: "TContract111",
        minTimestampMs: 0,
        maxTimestampMs: 1,
        fingerprint: null,
      }),
    ).rejects.toThrow();
  });
});

describe("resolveTransferEvent", () => {
  // Real, valid-checksum TRON base58 addresses (TronWeb.address.toHex throws
  // on anything else, so placeholder strings like "TTo111" can't be used
  // here). RECEIVING_HEX/OTHER_RECIPIENT_HEX are their real, verified
  // 0x-prefixed 20-byte hex forms — confirmed against a live Nile testnet
  // transaction's actual event data, not assumed: TronGrid decodes an
  // address-typed event parameter this way (no TRON 0x41 version byte, no
  // base58), even though the top-level contract_address field on the same
  // response IS base58.
  const RECEIVING = "TVJ6njG5EpUwJt4N9xjTrqU5za78cgadS2";
  const RECEIVING_HEX = "0xd3fd1b6f3f3a86303e2925844456c49876c4561f";
  const OTHER_RECIPIENT_HEX = "0xeca9bc828a3005b9a3b909f2cc5c2a54794de05f";

  const params = {
    txHash: "tx1",
    expectedToAddress: RECEIVING,
    expectedTokenContract: "TContract111",
    expectedRawAmount: 1_000_000n,
  };

  it("resolves cleanly when exactly one event matches (contract, to, value)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              event_name: "Transfer",
              contract_address: "TContract111",
              event_index: 3,
              block_number: 12_345,
              result: { from: "TFrom111", to: RECEIVING_HEX, value: "1000000" },
            },
          ],
        }),
      ),
    );
    const outcome = await createTronProvider().resolveTransferEvent(params);
    expect(outcome).toEqual({ kind: "resolved", eventIndex: 3, blockNumber: 12_345n });
  });

  it("never defaults to eventIndex 0 or guesses — returns not_found when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [] })));
    const outcome = await createTronProvider().resolveTransferEvent(params);
    expect(outcome).toEqual({ kind: "not_found" });
  });

  it("resolves the single matching event even when other unrelated Transfer events exist in the same transaction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              event_name: "Transfer",
              contract_address: "TContract111",
              event_index: 0,
              block_number: 12_345,
              result: { from: "TSomeoneElse", to: OTHER_RECIPIENT_HEX, value: "500000" },
            },
            {
              event_name: "Transfer",
              contract_address: "TContract111",
              event_index: 1,
              block_number: 12_345,
              result: { from: "TFrom111", to: RECEIVING_HEX, value: "1000000" },
            },
          ],
        }),
      ),
    );
    const outcome = await createTronProvider().resolveTransferEvent(params);
    expect(outcome).toEqual({ kind: "resolved", eventIndex: 1, blockNumber: 12_345n });
  });

  it("returns ambiguous — never guesses — when more than one event matches (contract, to, value) in one transaction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              event_name: "Transfer",
              contract_address: "TContract111",
              event_index: 0,
              block_number: 12_345,
              result: { from: "TFrom111", to: RECEIVING_HEX, value: "1000000" },
            },
            {
              event_name: "Transfer",
              contract_address: "TContract111",
              event_index: 5,
              block_number: 12_345,
              result: { from: "TFrom222", to: RECEIVING_HEX, value: "1000000" },
            },
          ],
        }),
      ),
    );
    const outcome = await createTronProvider().resolveTransferEvent(params);
    expect(outcome).toEqual({ kind: "ambiguous", candidateEventIndexes: [0, 5] });
  });

  it("matches even when TronGrid returns the hex address in a different case (defensive lowercasing)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              event_name: "Transfer",
              contract_address: "TContract111",
              event_index: 7,
              block_number: 12_345,
              result: { from: "TFrom111", to: RECEIVING_HEX.toUpperCase().replace("0X", "0x"), value: "1000000" },
            },
          ],
        }),
      ),
    );
    const outcome = await createTronProvider().resolveTransferEvent(params);
    expect(outcome).toEqual({ kind: "resolved", eventIndex: 7, blockNumber: 12_345n });
  });
});

describe("getExecutionResult", () => {
  it("reports solidified success when receipt.result is SUCCESS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ id: "tx1", receipt: { result: "SUCCESS" } })),
    );
    const outcome = await createTronProvider().getExecutionResult("tx1");
    expect(outcome).toEqual({ state: "solidified", success: true });
  });

  it("reports solidified failure for any non-SUCCESS receipt.result (e.g. REVERT)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ id: "tx1", receipt: { result: "REVERT" } })),
    );
    const outcome = await createTronProvider().getExecutionResult("tx1");
    expect(outcome).toEqual({ state: "solidified", success: false });
  });

  it("cross-checks the full node when missing from the solidity node — reports alsoMissingOnFullNode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({})) // solidity: not found
      .mockResolvedValueOnce(jsonResponse({})); // full node: also not found
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await createTronProvider().getExecutionResult("tx1");
    expect(outcome).toEqual({ state: "not_found_on_solidity_node", alsoMissingOnFullNode: true });
  });

  it("does not report a permanent failure for a transient provider error — reports provider_error, retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    const outcome = await createTronProvider().getExecutionResult("tx1");
    expect(outcome).toEqual({ state: "provider_error", retryable: true, message: "HTTP 503" });
  });
});

describe("getTokenDecimals", () => {
  it("returns the contract's decimals() result as a number", async () => {
    decimalsCall.mockResolvedValue(6);
    const decimals = await createTronProvider().getTokenDecimals("TContract111");
    expect(decimals).toBe(6);
  });

  it("sets an owner_address context before the call, without any private key — required by TronWeb's constant-call RPC, never for signing", async () => {
    decimalsCall.mockResolvedValue(6);
    await createTronProvider().getTokenDecimals("TContract111");
    expect(setAddressCall).toHaveBeenCalledWith("TContract111");
  });

  it("throws rather than guessing when decimals() returns something non-numeric", async () => {
    decimalsCall.mockResolvedValue(undefined);
    await expect(createTronProvider().getTokenDecimals("TContract111")).rejects.toThrow();
  });
});
