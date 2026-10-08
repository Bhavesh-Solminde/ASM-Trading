import { createAccountsForUser, writeSignupCapture } from "@asm/db";

export const DEMO_START_BALANCE = 100_000_000; // ₹10,00,000.00 in paise

/**
 * Everything a brand-new user needs beyond the User row, shared by the
 * email/password and Google sign-up paths: the demo + live accounts, and the
 * forensic signup capture. The capture is a separate write so a missing header
 * (dev, local) can't block the signup. `deviceFp` is a placeholder for a future
 * client-side fingerprint; the detector treats it as optional and IP + UA carry
 * the signal on their own.
 */
export async function provisionNewUser(
  userId: string,
  ctx: { ip: string; userAgent: string },
): Promise<void> {
  await createAccountsForUser(userId, DEMO_START_BALANCE);
  await writeSignupCapture({ userId, ip: ctx.ip, userAgent: ctx.userAgent });
}
