import { KYC_IDENTITY_FIELDS, UpdateProfileSchema, type KycIdentityField } from "@asm/contracts";

/** The seven identity fields as the form holds them: all text, in the order `KYC_IDENTITY_FIELDS` asks for them. */
export type DetailsDraft = Record<KycIdentityField, string>;

/** i18n key of the message under each field. Messages come from these keys, never from zod's English. */
export const DETAILS_ERROR_KEYS: Record<KycIdentityField, string> = {
  firstName: "kyc.err.firstName",
  lastName: "kyc.err.lastName",
  dateOfBirth: "kyc.err.dateOfBirth",
  aadhaar: "kyc.err.aadhaar",
  pan: "kyc.err.pan",
  address: "kyc.err.address",
  country: "kyc.err.country",
};

const UNDERAGE_KEY = "kyc.err.underage";

/** The form's starting values: what the profile holds (a date as YYYY-MM-DD), with the country defaulting to India. */
export function draftFromProfile(profile: Readonly<Record<KycIdentityField, string | null>>): DetailsDraft {
  const out = {} as DetailsDraft;
  for (const field of KYC_IDENTITY_FIELDS) out[field] = profile[field] ?? "";
  out.dateOfBirth = out.dateOfBirth.slice(0, 10);
  if (out.country.trim() === "") out.country = "India";
  return out;
}

/** Aadhaar is 12 digits; anything else typed or pasted (spaces, dashes) is dropped. */
export function sanitizeAadhaar(text: string): string {
  return text.replace(/[^0-9]/g, "").slice(0, 12);
}

/** PAN is 5 letters, 4 digits, 1 letter: upper case, letters and digits only, at most 10. */
export function sanitizePan(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

/**
 * A date of birth typed as digits only (the phone's number pad has no dash), shown as YYYY-MM-DD: the dashes go in
 * as the digits arrive and never trail, so backspace over the last digit leaves a clean value.
 */
export function formatDobInput(text: string): string {
  const d = text.replace(/[^0-9]/g, "").slice(0, 8);
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter((part) => part !== "").join("-");
}

/** True from the 18th birthday on. `dob` is a valid YYYY-MM-DD; `today` is read in local time. */
export function isAdult(dob: string, today: Date): boolean {
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return false;
  const cutoff = (today.getFullYear() - 18) * 10_000 + (today.getMonth() + 1) * 100 + today.getDate();
  return y * 10_000 + m * 100 + d <= cutoff;
}

/** The PATCH body: trimmed, Aadhaar without spaces, PAN in capitals (what the web form sends). */
export function detailsBody(draft: DetailsDraft): DetailsDraft {
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    dateOfBirth: draft.dateOfBirth.trim(),
    aadhaar: draft.aadhaar.replace(/\s/g, ""),
    pan: draft.pan.trim().toUpperCase(),
    address: draft.address.trim(),
    country: draft.country.trim(),
  };
}

const isField = (v: unknown): v is KycIdentityField => typeof v === "string" && (KYC_IDENTITY_FIELDS as readonly string[]).includes(v);

/**
 * Every field that is not ready to send, as an i18n key. Empty fields, then whatever the server's own
 * `UpdateProfileSchema` rejects (so the form and the server cannot disagree on a format), then under 18.
 */
export function detailsProblems(draft: DetailsDraft, today: Date): Partial<Record<KycIdentityField, string>> {
  const body = detailsBody(draft);
  const out: Partial<Record<KycIdentityField, string>> = {};
  for (const field of KYC_IDENTITY_FIELDS) if (body[field] === "") out[field] = DETAILS_ERROR_KEYS[field];
  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (isField(field) && out[field] === undefined) out[field] = DETAILS_ERROR_KEYS[field];
    }
  }
  if (out.dateOfBirth === undefined && !isAdult(body.dateOfBirth, today)) out.dateOfBirth = UNDERAGE_KEY;
  return out;
}
