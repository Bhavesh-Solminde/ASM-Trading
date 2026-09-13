import pino, { type Logger, type LoggerOptions } from "pino";
import { config } from "@asm/config";

export { newCorrelationId } from "./correlation.js";
export type { Logger } from "pino";

/**
 * Redaction is applied at the logger, not at call sites, so it cannot be
 * forgotten. Paths are explicit rather than pattern-matched so the list is
 * auditable.
 */
const REDACT_PATHS = [
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "sessionToken",
  "cookie",
  "secret",
  "authorization",
  "*.password",
  "*.token",
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers['set-cookie']",
];

export function buildLogger(opts: {
  level: string;
  destination?: NodeJS.WritableStream;
}): Logger {
  const options: LoggerOptions = {
    level: opts.level,
    // `null` (not `undefined`) is pino's documented way to drop the default
    // pid/hostname base fields — `undefined` fails to typecheck under this
    // repo's `exactOptionalPropertyTypes: true`, since pino's `base` type is
    // `{ [key: string]: any } | null`, not `| undefined`.
    base: null,
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ lvl: label }),
    },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

// `logger` must be usable as `import { logger } from "@asm/logger"` followed
// by `logger.info(...)`, but merely IMPORTING this module must never touch
// `@asm/config`'s `config` object — reading any property on `config` (e.g.
// `config.logLevel`) triggers a full `process.env` parse and throws if the
// environment doesn't satisfy the schema. A plain
// `export const logger = buildLogger({ level: config.logLevel })` at module
// scope would run that parse the instant this file loads, for ANY importer
// — including a test file that only wants `buildLogger`/`newCorrelationId`
// and never references `logger` at all, in an environment with no valid
// `.env` loaded.
//
// So `logger` is a `get`-only Proxy over an empty object: the real pino
// instance is created lazily, on first property/method access, and cached
// after that. Only the `get` trap is implemented — `ownKeys`,
// `getOwnPropertyDescriptor`, `has`, etc. are left as Proxy defaults acting
// on the (permanently empty) target. That's deliberate: a prior Proxy-based
// fix on `@asm/config` implemented `getOwnPropertyDescriptor`/`ownKeys` to
// report descriptors from a *different* object (the real lazily-computed
// value) than the actual proxy target, which violates the ECMAScript Proxy
// invariants — you may not report a property as present/non-configurable
// when the target doesn't actually have it — and threw `TypeError` on
// `Object.keys()`, spread, `JSON.stringify()`, and `for...in`. A logger is
// used by calling methods (`.info()`, `.warn()`, `.child()`), never by
// enumerating or serializing it, so leaving those traps at their defaults
// avoids the invariant entirely: `Object.keys(logger)` and `{...logger}`
// just return `{}`/empty, since `ownKeys`/`getOwnPropertyDescriptor` see the
// permanently-empty target and never invoke `get`. (`JSON.stringify(logger)`
// is a partial exception: its algorithm also probes for a `toJSON` method
// via a plain `Get`, which — like any other property read — goes through
// this `get` trap and does construct the real logger; this is harmless and
// still invariant-safe, just not fully lazy for that one specific call. No
// code in this codebase serializes a logger, so this is not a real concern.)
let cachedLogger: Logger | undefined;

function getRealLogger(): Logger {
  if (!cachedLogger) {
    cachedLogger = buildLogger({ level: config.logLevel });
  }
  return cachedLogger;
}

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop, _receiver) {
    const real = getRealLogger();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
  // Without this, `logger.level = "debug"` (a documented pino idiom for
  // changing verbosity at runtime) would silently write onto the empty
  // proxy target instead of the real instance, and the `get` trap above
  // would keep reading the real instance's unchanged value — a silent
  // no-op with no error.
  set(_target, prop, value) {
    Reflect.set(getRealLogger(), prop, value);
    return true;
  },
});

/** A logger that stamps a correlation id on every line it writes. */
export function childLogger(cid: string): Logger {
  return logger.child({ cid });
}
