import type { GateState } from "@/api/errors";

export type GateRoute =
  | "/splash"
  | "/login"
  | "/lock"
  | "/lock-setup"
  | "/maintenance"
  | "/blocked"
  | "/update-required";

/** Where the app must be given its session, lock and gate state. `null` means stay on the current route. */
export function routeFor(s: {
  ready: boolean;
  token: string | null;
  locked: boolean;
  lockChosen: boolean;
  gate: GateState;
  belowMin: boolean;
}): GateRoute | null {
  if (!s.ready) return "/splash";
  if (s.belowMin || s.gate === "upgrade") return "/update-required";
  if (s.gate === "maintenance") return "/maintenance";
  if (s.gate === "blocked") return "/blocked";
  if (!s.token) return "/login";
  if (s.locked) return "/lock";
  if (!s.lockChosen) return "/lock-setup";
  return null;
}

/** Signed-out screens the user may move between without being sent back to /login. */
const AUTH_PATHS: readonly string[] = ["/login", "/register", "/forgot"];

/** Every route the gatekeeper owns: an unlocked, signed-in user never rests on one of these. */
const GATE_PATHS: readonly string[] = [
  "/",
  ...AUTH_PATHS,
  "/lock",
  "/lock-setup",
  "/maintenance",
  "/blocked",
  "/update-required",
];

/** The route to replace the current one with, or `null` to stay put. */
export function redirectFor(target: GateRoute | null, pathname: string): Exclude<GateRoute, "/splash"> | "/trade" | null {
  if (target === "/splash") return null;
  if (target === null) return GATE_PATHS.includes(pathname) ? "/trade" : null;
  if (target === "/login") return AUTH_PATHS.includes(pathname) ? null : "/login";
  return pathname === target ? null : target;
}
