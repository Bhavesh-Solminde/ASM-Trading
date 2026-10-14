import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import { z } from "zod";
import { api } from "@/api/client";

const GoogleResult = z.object({ token: z.string(), userId: z.string(), created: z.boolean() });

/** The web OAuth client id; Google issues the ID token for it (server accepts it as an audience). */
export function configureGoogle(webClientId: string) {
  GoogleSignin.configure({ webClientId, offlineAccess: false });
}

/** Returns the app session token, or null when the user cancelled the Google sheet. */
export async function signInWithGoogle(): Promise<string | null> {
  await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res) || !res.data.idToken) return null;
  const out = await api("/api/v1/auth/google/native", {
    method: "POST",
    body: { idToken: res.data.idToken },
    schema: GoogleResult,
    auth: false,
  });
  return out.token;
}
