import { ApiError, GENERIC_ERROR } from "@/api/errors";

type Translate = (key: string) => string;

/** ApiError codes that switch the whole app to a gate screen; their message is not user copy. */
const GATE_CODES = new Set(["maintenance", "blocked", "upgrade"]);

/**
 * User-facing text for a failed call. Server messages show as-is, except the
 * client-side English fallbacks, which are replaced by translated strings.
 */
export function errorText(e: unknown, t: Translate, fallbackKey = "common.genericError"): string {
  if (e instanceof ApiError) {
    if (e.code === "offline") return t("common.noConnection");
    if (e.message === GENERIC_ERROR || (e.code !== null && GATE_CODES.has(e.code))) return t("common.genericError");
    return e.message;
  }
  return t(fallbackKey);
}

const FIELD_KEYS: Record<string, string> = {
  name: "auth.errName",
  email: "auth.errEmail",
  password: "auth.errPassword",
};

/** Translation key for the first failed field of a contracts schema parse. */
export function validationKey(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): string {
  const field = issues[0]?.path[0];
  return (typeof field === "string" ? FIELD_KEYS[field] : undefined) ?? "auth.checkDetails";
}
