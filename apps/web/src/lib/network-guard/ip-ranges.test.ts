import { describe, expect, it } from "vitest";
import { IpRangeMap, IpRangeSet, parseCidr, parseIp } from "./ip-ranges";

describe("parseIp", () => {
  it("keys IPv4 by its 32-bit value, including IPv4-mapped IPv6", () => {
    expect(parseIp("1.2.3.4")).toEqual({ family: 4, key: 0x01020304 });
    expect(parseIp("255.255.255.255")).toEqual({ family: 4, key: 0xffffffff });
    expect(parseIp("::ffff:1.2.3.4")).toEqual({ family: 4, key: 0x01020304 });
  });

  it("keys IPv6 by its /64 network, expanding ::", () => {
    expect(parseIp("2001:db8:1:2:aaaa::1")).toEqual({ family: 6, key: 0x20010db800010002n });
    expect(parseIp("2001:db8::")).toEqual({ family: 6, key: 0x20010db800000000n });
    expect(parseIp("::")).toEqual({ family: 6, key: 0n });
    expect(parseIp("64:ff9b::1.2.3.4")).toEqual({ family: 6, key: 0x0064ff9b00000000n });
  });

  it("rejects anything that isn't an address", () => {
    expect(parseIp("not-an-ip")).toBeNull();
    expect(parseIp("1.2.3")).toBeNull();
    expect(parseIp("")).toBeNull();
  });
});

describe("parseCidr", () => {
  it("aligns the network and covers the whole block", () => {
    expect(parseCidr("10.1.2.3/8")).toEqual({ family: 4, start: 0x0a000000, end: 0x0affffff });
    expect(parseCidr("1.2.3.4")).toEqual({ family: 4, start: 0x01020304, end: 0x01020304 });
    expect(parseCidr("0.0.0.0/0")).toEqual({ family: 4, start: 0, end: 0xffffffff });
    expect(parseCidr("2001:db8::/32")).toEqual({ family: 6, start: 0x20010db800000000n, end: 0x20010db8ffffffffn });
  });

  it("widens IPv6 blocks longer than /64 to their /64", () => {
    expect(parseCidr("2001:db8:0:5::7/128")).toEqual({ family: 6, start: 0x20010db800000005n, end: 0x20010db800000005n });
  });

  it("rejects bad prefixes", () => {
    expect(parseCidr("1.2.3.4/33")).toBeNull();
    expect(parseCidr("1.2.3.4/x")).toBeNull();
    expect(parseCidr("nope/24")).toBeNull();
  });
});

describe("IpRangeSet", () => {
  const set = new IpRangeSet(
    ["172.224.226.0/27", "172.224.226.32/31", "10.0.0.0/8", "10.5.0.0/16", "2a02:26f7:b3c0:4000::/64"].map(
      (c) => parseCidr(c)!,
    ),
  );

  it("finds addresses inside any listed block, edges included", () => {
    expect(set.has("172.224.226.0")).toBe(true);
    expect(set.has("172.224.226.31")).toBe(true);
    expect(set.has("172.224.226.33")).toBe(true);
    expect(set.has("10.255.255.255")).toBe(true);
    expect(set.has("2a02:26f7:b3c0:4000:1234::9")).toBe(true);
  });

  it("misses addresses just outside", () => {
    expect(set.has("172.224.226.34")).toBe(false);
    expect(set.has("11.0.0.0")).toBe(false);
    expect(set.has("9.255.255.255")).toBe(false);
    expect(set.has("2a02:26f7:b3c0:4001::1")).toBe(false);
    expect(set.has("garbage")).toBe(false);
  });

  it("merges nested and overlapping blocks", () => {
    expect(set.size).toBe(4);
  });
});

describe("IpRangeMap", () => {
  it("returns the value of the range holding the address", () => {
    const map = new IpRangeMap([
      { span: { family: 4, start: parseIp("49.36.0.0")!.key as number, end: parseIp("49.39.255.255")!.key as number }, value: "IN" },
      { span: { family: 4, start: parseIp("39.32.0.0")!.key as number, end: parseIp("39.63.255.255")!.key as number }, value: "PK" },
      { span: parseCidr("2405:200::/29")!, value: "IN" },
    ]);
    expect(map.get("49.37.1.1")).toBe("IN");
    expect(map.get("39.50.0.1")).toBe("PK");
    expect(map.get("2405:201:1:2::3")).toBe("IN");
    expect(map.get("49.40.0.0")).toBeUndefined();
    expect(map.get("8.8.8.8")).toBeUndefined();
  });
});
