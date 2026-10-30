import type { UpdateProfileInput } from "@asm/contracts";

/** The server's own cap (`UpdateProfileSchema.nickname`); a test keeps the two equal. */
export const NICKNAME_MAX = 40;

/** Aadhaar as `•••• •••• 1234`: only the last four digits ever show. Null when there is nothing on file. */
export function maskAadhaar(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits === "") return null;
  return `•••• •••• ${digits.length >= 4 ? digits.slice(-4) : "••••"}`;
}

/** i18n key of the problem with a display name, or null when it can be saved. */
export function nicknameProblem(nickname: string): string | null {
  const n = nickname.trim();
  return n === "" || n.length > NICKNAME_MAX ? "profile.err.nickname" : null;
}

/** The PATCH body: the nickname alone. Identity fields are edited in the KYC flow, which owns their freeze rules. */
export function profileBody(nickname: string): UpdateProfileInput {
  return { nickname: nickname.trim() };
}

/** Save is offered for a valid nickname that differs from the saved one. */
export function saveEnabled(draft: string, saved: string | null): boolean {
  return nicknameProblem(draft) === null && draft.trim() !== (saved ?? "").trim();
}

export interface IdentityRow {
  id: "name" | "dateOfBirth" | "aadhaar" | "pan" | "address" | "country";
  labelKey: string;
  /** Null when nothing is on file: the screen shows "Not added". */
  value: string | null;
}

type IdentityProfile = {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  aadhaar: string | null;
  pan: string | null;
  address: string | null;
  country: string | null;
};

const orNull = (s: string | null) => (s !== null && s.trim() !== "" ? s.trim() : null);

/** The identity on file, in the order the KYC form asks for it, as read-only rows. */
export function identityRows(p: IdentityProfile): IdentityRow[] {
  const name = [orNull(p.firstName), orNull(p.lastName)].filter((s) => s !== null).join(" ");
  return [
    { id: "name", labelKey: "profile.field.name", value: name === "" ? null : name },
    { id: "dateOfBirth", labelKey: "kyc.field.dateOfBirth", value: orNull(p.dateOfBirth === null ? null : p.dateOfBirth.slice(0, 10)) },
    { id: "aadhaar", labelKey: "kyc.field.aadhaar", value: maskAadhaar(p.aadhaar) },
    { id: "pan", labelKey: "kyc.field.pan", value: orNull(p.pan) },
    { id: "address", labelKey: "kyc.field.address", value: orNull(p.address) },
    { id: "country", labelKey: "kyc.field.country", value: orNull(p.country) },
  ];
}
