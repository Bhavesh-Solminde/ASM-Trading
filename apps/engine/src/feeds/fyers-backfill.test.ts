import { describe, expect, it, vi } from "vitest";
import { fetchFyersHistory, parseFyersHistory } from "./fyers-backfill";

describe("parseFyersHistory", () => {
  it("maps the [ts,o,h,l,c,v] array rows into named candles", () => {
    const body = {
      s: "ok",
      candles: [
        [1_729_800_000, 25_100.1, 25_110.5, 25_095.0, 25_108.3, 0],
        [1_729_800_060, 25_108.3, 25_115.0, 25_104.2, 25_112.7, 0],
      ],
    };
    const out = parseFyersHistory(body);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ ts: 1_729_800_000, o: 25_100.1, h: 25_110.5, l: 25_095.0, c: 25_108.3, v: 0 });
  });

  it("returns an empty array when the response is an error", () => {
    expect(parseFyersHistory({ s: "error", message: "no data" })).toEqual([]);
    expect(parseFyersHistory({ s: "ok" })).toEqual([]);
    expect(parseFyersHistory({ s: "ok", candles: "not-an-array" })).toEqual([]);
  });

  it("skips rows with non-finite or non-positive OHLC — defensive against bad data", () => {
    const body = {
      s: "ok",
      candles: [
        [1_729_800_000, 25_100, 25_110, 25_095, 25_108, 0], // good
        [1_729_800_060, "x", 1, 1, 1, 0],                   // bad open
        [1_729_800_120, 1, 1, 1, 0, 0],                     // zero close
        [1_729_800_180, 1, 1, 1, 1],                        // length < 5 that still has 5 items via destructure
      ],
    };
    const out = parseFyersHistory(body);
    expect(out).toHaveLength(2); // the good row + the shorthand all-ones row
    expect(out[0]!.ts).toBe(1_729_800_000);
  });
});

describe("fetchFyersHistory", () => {
  it("hits /data/history with the right query + Authorization header, parses candles", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      s: "ok",
      candles: [[1_729_800_000, 25_100, 25_110, 25_095, 25_108, 0]],
    }), { status: 200 }));

    const candles = await fetchFyersHistory({
      appId: "FQEO03EUPG-100",
      accessToken: "AT_XYZ",
      symbol: "NSE:NIFTY50-INDEX",
      resolution: "1",
      rangeFromEpoch: 1_729_799_940,
      rangeToEpoch:   1_729_800_060,
      fetchImpl: fetchMock,
    });

    expect(candles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [rawUrl, init] = fetchMock.mock.calls[0] as unknown as [URL | string, RequestInit];
    const url = new URL(String(rawUrl));
    expect(url.origin + url.pathname).toBe("https://api-t1.fyers.in/data/history");
    expect(url.searchParams.get("symbol")).toBe("NSE:NIFTY50-INDEX");
    expect(url.searchParams.get("resolution")).toBe("1");
    expect(url.searchParams.get("date_format")).toBe("0");
    expect(url.searchParams.get("range_from")).toBe("1729799940");
    expect(url.searchParams.get("range_to")).toBe("1729800060");
    expect(init.headers).toMatchObject({ Authorization: "FQEO03EUPG-100:AT_XYZ" });
  });

  it("returns [] on a non-200 response rather than throwing", async () => {
    const fetchMock = vi.fn(async () => new Response("Forbidden", { status: 403 }));
    const out = await fetchFyersHistory({
      appId: "x", accessToken: "y", symbol: "NSE:NIFTY50-INDEX",
      resolution: "D", rangeFromEpoch: 0, rangeToEpoch: 1,
      fetchImpl: fetchMock,
    });
    expect(out).toEqual([]);
  });
});
