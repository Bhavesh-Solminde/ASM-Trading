import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export interface ProfileView {
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  aadhaar: string | null;
  address: string | null;
  country: string | null;
  kycStatus: string;
  twoFaForLogin: boolean;
  twoFaForWithdrawal: boolean;
}

export async function loadProfile(actorId: string): Promise<ProfileView> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
    select: {
      email: true,
      emailVerified: true,
      nickname: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      aadhaar: true,
      address: true,
      country: true,
      kycStatus: true,
      twoFaForLogin: true,
      twoFaForWithdrawal: true,
    },
  });

  return {
    ...user,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
  };
}

/**
 * Writes only the whitelisted profile fields.
 *
 * Fields are picked explicitly rather than spread, so even if the schema
 * changes, `role`, `kycStatus` and `cumulativeDeposits` cannot be reached
 * through this path.
 */
export async function updateProfile(
  actorId: string,
  input: {
    nickname?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    dateOfBirth?: string | undefined;
    aadhaar?: string | undefined;
    address?: string | undefined;
    country?: string | undefined;
  },
): Promise<void> {
  // Assign only the fields actually supplied. Building the object conditionally
  // (rather than passing `undefined` values) satisfies exactOptionalPropertyTypes
  // and leaves untouched fields as they were.
  const data: Prisma.UserUpdateInput = {};
  if (input.nickname !== undefined) data.nickname = input.nickname;
  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;
  if (input.dateOfBirth !== undefined) data.dateOfBirth = new Date(input.dateOfBirth);
  if (input.aadhaar !== undefined) data.aadhaar = input.aadhaar;
  if (input.address !== undefined) data.address = input.address;
  if (input.country !== undefined) data.country = input.country;

  await prisma.user.update({ where: { id: actorId }, data });
}

export async function setTwoFactorPreferences(
  actorId: string,
  prefs: { forLogin: boolean; forWithdrawal: boolean },
): Promise<void> {
  await prisma.user.update({
    where: { id: actorId },
    data: {
      twoFaForLogin: prefs.forLogin,
      twoFaForWithdrawal: prefs.forWithdrawal,
      twoFaEnabled: prefs.forLogin || prefs.forWithdrawal,
    },
  });
}
