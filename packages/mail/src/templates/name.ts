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
