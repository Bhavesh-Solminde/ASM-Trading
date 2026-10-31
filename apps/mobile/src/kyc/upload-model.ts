import { ApiError, GENERIC_ERROR } from "@/api/errors";
import type { KycDocKind } from "./kyc-flow";

/** A photo goes over mobile data, so it gets longer than the 15 s money POSTs. The server may still have saved it. */
export const UPLOAD_TIMEOUT_MS = 30_000;

/** The two multipart parts of `POST /api/account/kyc/documents`: the `kind` and the `file` (a React Native file record). */
export function kycUploadParts(kind: KycDocKind, uri: string): { kind: KycDocKind; file: { uri: string; name: string; type: string } } {
  return { kind, file: { uri, name: `${kind.toLowerCase()}.jpg`, type: "image/jpeg" } };
}

/** React Native's FormData takes a `{ uri, name, type }` record for a file part and streams it from disk. */
export function buildKycUploadForm(kind: KycDocKind, uri: string): FormData {
  const parts = kycUploadParts(kind, uri);
  const form = new FormData();
  form.append("kind", parts.kind);
  form.append("file", parts.file as unknown as Blob);
  return form;
}

/**
 * The text for a failed upload. offline, timeout and 5xx are translated. A 4xx shows the server's own message
 * (English, accepted for now): 413 "too large", 400 wrong type or missing part, 409 "details are locked".
 */
export function uploadErrorText(e: unknown, t: (key: string) => string): string {
  if (e instanceof ApiError) {
    if (e.code === "offline") return t("common.noConnection");
    if (e.code === "timeout") return t("kyc.uploadTimedOut");
    if (e.status >= 400 && e.status < 500 && e.message !== GENERIC_ERROR && e.message.trim() !== "") return e.message;
  }
  return t("common.genericError");
}
