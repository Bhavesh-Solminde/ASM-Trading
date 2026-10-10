/** How we address the user: full name, else nickname, else the email local part. */
export function displayName(profile: {
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  email: string;
}): string {
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (profile.nickname && profile.nickname.trim()) return profile.nickname.trim();
  return profile.email.split("@")[0] ?? "Trader";
}

/**
 * The name to greet someone by, or null when we only have their email —
 * templates then say "Hi there," instead of echoing an email username.
 */
export function personName(profile: {
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
}): string | null {
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return profile.nickname?.trim() || null;
}
