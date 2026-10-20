import { isIP } from "node:net";

/**
 * An address reduced to a sortable key. IPv4 keeps all 32 bits; IPv6 keeps its
 * top 64 (the /64 network), which is the finest granularity any of our lists
 * care about. A list entry longer than /64 therefore covers its whole /64.
 */
export type IpKey = { readonly family: 4; readonly key: number } | { readonly family: 6; readonly key: bigint };

function ipv4ToInt(ip: string): number {
  const p = ip.split(".");
  return ((Number(p[0]) << 24) | (Number(p[1]) << 16) | (Number(p[2]) << 8) | Number(p[3])) >>> 0;
}

function ipv6High64(ip: string): bigint {
  let s = ip;
  // An embedded dotted quad only ever sits in the low 64 bits.
  const dotted = s.lastIndexOf(":");
  if (s.includes(".")) s = `${s.slice(0, dotted)}:0:0`;
  const [head = "", tail] = s.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  let out = 0n;
  for (let i = 0; i < 4; i++) out = (out << 16n) | BigInt(parseInt(groups[i] || "0", 16));
  return out;
}

export function parseIp(raw: string): IpKey | null {
  const unmapped = raw.toLowerCase().startsWith("::ffff:") ? raw.slice(7) : raw;
  if (isIP(unmapped) === 4) return { family: 4, key: ipv4ToInt(unmapped) };
  if (isIP(raw) === 6) return { family: 6, key: ipv6High64(raw) };
  return null;
}

type Span = { family: 4; start: number; end: number } | { family: 6; start: bigint; end: bigint };

/** "a.b.c.d", "a.b.c.d/n", "x::y" or "x::y/n" → the span it covers, or null. */
export function parseCidr(raw: string): Span | null {
  const [addr = "", bitsRaw] = raw.trim().split("/");
  const ip = parseIp(addr);
  if (!ip) return null;
  const bits = bitsRaw === undefined ? (ip.family === 4 ? 32 : 128) : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > (ip.family === 4 ? 32 : 128)) return null;
  if (ip.family === 4) {
    const host = bits === 0 ? 0xffffffff : (2 ** (32 - bits) - 1);
    const start = (ip.key - (ip.key % (host + 1))) >>> 0;
    return { family: 4, start, end: start + host };
  }
  const hostBits = BigInt(Math.max(0, 64 - bits));
  const host = (1n << hostBits) - 1n;
  const start = ip.key & ~host & 0xffffffffffffffffn;
  return { family: 6, start, end: start | host };
}

class Family<K extends number | bigint, V> {
  // Packed into typed arrays once built: half a million spans stay a few MB
  // instead of a heap of boxed numbers and BigInts.
  private readonly starts: ArrayLike<K>;
  private readonly ends: ArrayLike<K>;
  private readonly values: readonly V[];

  constructor(rows: { start: K; end: K; value: V }[], merge: boolean, wide: boolean) {
    rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const starts: K[] = [];
    const ends: K[] = [];
    const values: V[] = [];
    for (const r of rows) {
      const last = ends.length - 1;
      // Sets merge overlapping spans; maps keep the first owner.
      if (last >= 0 && r.start <= ends[last]!) {
        if (merge && r.end > ends[last]!) ends[last] = r.end;
        if (merge || r.end <= ends[last]!) continue;
      }
      starts.push(r.start);
      ends.push(r.end);
      values.push(r.value);
    }
    const pack = (a: K[]) =>
      (wide ? BigUint64Array.from(a as bigint[]) : Uint32Array.from(a as number[])) as unknown as ArrayLike<K>;
    this.starts = pack(starts);
    this.ends = pack(ends);
    this.values = values;
  }

  get size(): number {
    return this.starts.length;
  }

  find(key: K): V | undefined {
    let lo = 0;
    let hi = this.starts.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.starts[mid]! <= key) {
        hit = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return hit >= 0 && key <= this.ends[hit]! ? this.values[hit] : undefined;
  }
}

/** Sorted address spans with a value each, searched in O(log n). */
export class IpRangeMap<V> {
  private readonly v4: Family<number, V>;
  private readonly v6: Family<bigint, V>;

  constructor(entries: Iterable<{ span: Span; value: V }>, opts: { merge?: boolean } = {}) {
    const v4: { start: number; end: number; value: V }[] = [];
    const v6: { start: bigint; end: bigint; value: V }[] = [];
    for (const { span, value } of entries) {
      if (span.family === 4) v4.push({ start: span.start, end: span.end, value });
      else v6.push({ start: span.start, end: span.end, value });
    }
    this.v4 = new Family(v4, opts.merge ?? false, false);
    this.v6 = new Family(v6, opts.merge ?? false, true);
  }

  get size(): number {
    return this.v4.size + this.v6.size;
  }

  get(ip: string): V | undefined {
    const k = parseIp(ip);
    if (!k) return undefined;
    return k.family === 4 ? this.v4.find(k.key) : this.v6.find(k.key);
  }
}

/** A plain block list: does any listed span contain the address? */
export class IpRangeSet {
  private readonly map: IpRangeMap<true>;

  constructor(spans: Iterable<Span>) {
    const entries = function* () {
      for (const span of spans) yield { span, value: true as const };
    };
    this.map = new IpRangeMap(entries(), { merge: true });
  }

  get size(): number {
    return this.map.size;
  }

  has(ip: string): boolean {
    return this.map.get(ip) === true;
  }
}
