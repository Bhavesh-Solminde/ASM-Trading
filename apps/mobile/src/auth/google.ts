import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import { z } from "zod";
import { api } from "@/api/client";

const GoogleResult = z.object({ token: z.string(), userId: z.string(), created: z.boolean() });

/** The web OAuth client id; Google issues the ID token for it (server accepts it as an audience). */
export function configureGoogle(webClientId: string) {
  GoogleSignin.configure({ webClientId, offlineAccess: false });
}

/**
 * Forgets the Google account picked at sign-in, so the next "Continue with Google" on a shared phone asks
 * again. Best effort: a no-op when Google sign-in was never configured.
 */
export function signOutOfGoogle(): void {
  try {
    void GoogleSignin.signOut().catch(() => {});
  } catch {
    // Not configured, or the native module is missing.
  }
}

/** Returns the app session, or null when the user cancelled the Google sheet. */
export async function signInWithGoogle(): Promise<{ token: string; userId: string } | null> {
  await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res) || !res.data.idToken) return null;
  const out = await api("/api/v1/auth/google/native", {
    method: "POST",
    body: { idToken: res.data.idToken },
    schema: GoogleResult,
    auth: false,
  });
  return { token: out.token, userId: out.userId };
}
