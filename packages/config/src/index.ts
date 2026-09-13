import { z } from "zod";

const EnvSchema = z.strictObject({
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  BANK_FEED: z.enum(["simulated", "sms", "email"]).default("simulated"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug"]).default("info"),
});

// process.env carries dozens of unrelated ambient OS vars (PATH, HOME, SHELL, …)
// that would make a directly-strict-parsed schema throw immediately in any real
// process. Pick only the keys this schema knows about into a plain object first,
// then run the strict schema against that subset — unknown keys among the ones
// being validated are still rejected, but ambient vars never reach the schema.
const KNOWN_KEYS = [
  "DATABASE_URL",
  "DATABASE_MIGRATE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "BANK_FEED",
  "NODE_ENV",
  "LOG_LEVEL",
] as const;

function pickKnownKeys(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const picked: Record<string, string | undefined> = {};
  for (const key of KNOWN_KEYS) {
    if (key in env) {
      picked[key] = env[key];
    }
  }
  return picked;
}

export type BankFeedKind = "simulated" | "sms" | "email";

export interface Config {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly sessionSecret: string;
  readonly bankFeed: BankFeedKind;
  readonly nodeEnv: "development" | "test" | "production";
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug";
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(pickKnownKeys(env));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment — ${detail}`);
  }
  const e = parsed.data;
  return Object.freeze({
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    sessionSecret: e.SESSION_SECRET,
    bankFeed: e.BANK_FEED,
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
  });
}

// Lazy: importing this module (e.g. to get `parseConfig` for tests) must never
// trigger env parsing. Only accessing a field on `config` computes it — once,
// then caches the result.
//
// A Proxy-over-empty-target was tried here first and rejected: its
// `getOwnPropertyDescriptor` trap reported descriptors from the real (lazily
// computed) config while the proxy's own target stayed `{}` forever. Per the
// ECMAScript Proxy invariants, a trap may not report a property as
// non-configurable unless the target itself actually has it as a
// non-configurable own property — so `Object.keys(config)`, `{...config}`,
// `JSON.stringify(config)`, and `for...in config` all threw a TypeError at
// runtime, and `console.log(config)` silently printed `{}` because Node's
// `util.inspect` reads the proxy's raw target directly, bypassing traps.
//
// Plain getters avoid the mismatch entirely: each field is defined with
// `enumerable: true` on the object itself (not delegated to a stand-in
// target), so `Object.keys`, spread, `JSON.stringify`, and `for...in` all see
// real own properties and behave correctly (see the inspection hook below for
// `console.log`). No `set` trap is needed either — a getter with no matching
// setter throws on assignment in strict mode (ESM is strict by default),
// which satisfies the "frozen" framing without `Object.freeze` on this
// object.
let cachedConfig: Config | undefined;

function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = parseConfig(process.env);
  }
  return cachedConfig;
}

function lazyField<K extends keyof Config>(key: K): PropertyDescriptor {
  return {
    get(): Config[K] {
      return getConfig()[key];
    },
    enumerable: true,
    configurable: true,
  };
}

export const config: Config = Object.defineProperties({} as Config, {
  databaseUrl: lazyField("databaseUrl"),
  redisUrl: lazyField("redisUrl"),
  sessionSecret: lazyField("sessionSecret"),
  bankFeed: lazyField("bankFeed"),
  nodeEnv: lazyField("nodeEnv"),
  logLevel: lazyField("logLevel"),
});

// Node's `util.inspect` (what `console.log` uses to print objects) shows a
// plain getter as the literal string `[Getter]` rather than evaluating it,
// since evaluating an arbitrary getter for a debug print could have side
// effects. That's a safe default in general, but here it would make
// `console.log(config)` show every field as `[Getter]` instead of its real
// value. `config`'s getters are pure and side-effect-free (beyond the
// one-time parse), so opt back in to real values by providing an explicit
// inspection hook that hands back the fully materialized config.
Object.defineProperty(config, Symbol.for("nodejs.util.inspect.custom"), {
  value(): Config {
    return getConfig();
  },
  enumerable: false,
});
