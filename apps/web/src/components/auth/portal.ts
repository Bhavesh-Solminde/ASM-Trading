/** Which sign-in portal an auth form serves. Regular and affiliate accounts are separate users. */
export type AuthPortal = "user" | "affiliate";

export const PORTAL_PATHS = {
  user: { login: "/login", register: "/register", forgot: "/forgot-password", home: "/trade" },
  affiliate: {
    login: "/affiliate/login",
    register: "/affiliate/register",
    forgot: "/affiliate/forgot-password",
    home: "/affiliate/dashboard",
  },
} as const satisfies Record<AuthPortal, Record<"login" | "register" | "forgot" | "home", string>>;

/** The user portal sends exactly today's body; only the affiliate portal adds `portal`. */
export function withPortal<T extends object>(portal: AuthPortal, body: T): T | (T & { portal: "affiliate" }) {
  return portal === "user" ? body : { ...body, portal };
}
