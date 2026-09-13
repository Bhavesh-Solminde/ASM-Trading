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
// trigger env parsing. Only accessing a property on `config` computes it — once,
// then caches the result — via a Proxy so the exported shape stays unchanged.
let cachedConfig: Config | undefined;

function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = parseConfig(process.env);
  }
  return cachedConfig;
}

export const config: Config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    return Reflect.get(getConfig(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(getConfig(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(getConfig());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getConfig(), prop);
  },
});
