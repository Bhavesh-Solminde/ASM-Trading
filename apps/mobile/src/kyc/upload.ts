import { api } from "@/api/client";
import type { KycDocKind } from "./kyc-flow";
import { UPLOAD_TIMEOUT_MS, buildKycUploadForm } from "./upload-model";

/**
 * Uploads one KYC photo, replacing any earlier one of that kind. Throws an ApiError (see `uploadErrorText`). It
 * does not retry: the screen shows the error and a Retry button, and the server replaces the document either way.
 */
export async function uploadKycDocument(kind: KycDocKind, uri: string): Promise<void> {
  await api("/api/account/kyc/documents", { method: "POST", form: buildKycUploadForm(kind, uri), timeoutMs: UPLOAD_TIMEOUT_MS });
}
