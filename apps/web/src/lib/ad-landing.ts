/** Forward only campaign attribution; never pass arbitrary ad URL parameters. */
const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "fbclid"] as const;

export function registrationHref(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const key of CAMPAIGN_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.length <= 500) query.set(key, value);
  }
  const search = query.toString();
  return search ? `/register?${search}` : "/register";
}

export const AD_ENTRY_KEY = "ixt:ad-entry:v1";
export const LOGIN_PIXEL_COOKIE = "ixt_meta_login";
