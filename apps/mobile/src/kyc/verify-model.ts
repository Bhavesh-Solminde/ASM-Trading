import { ApiError, GENERIC_ERROR } from "@/api/errors";
import type { IconName } from "@/ui/icon-glyphs";
import { KYC_GROUPS, groupStates, type KycDocKind, type KycGroupId, type KycGroupState, type KycStep } from "./kyc-flow";

export type KycStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED";

/** Which verify screen shows: the done card, the in-review card, the rejection, or the steps. */
export type VerifyPhase = "verified" | "pending" | "rejected" | "flow";

/**
 * REJECTED shows the reason first; "Start again" (`restarted`) then opens the same steps a new user sees, with
 * every photo and detail already on file. PENDING and VERIFIED never show steps: the server freezes both.
 */
export function verifyPhase(status: KycStatus, restarted: boolean): VerifyPhase {
  if (status === "VERIFIED") return "verified";
  if (status === "PENDING") return "pending";
  if (status === "REJECTED") return restarted ? "flow" : "rejected";
  return "flow";
}

/** The details (and the photos) are frozen on the server while a submission is in review or approved (409). */
export function detailsEditable(status: KycStatus): boolean {
  return status === "NOT_STARTED" || status === "REJECTED";
}

export type StepAction = { type: "details" } | { type: "capture"; kind: KycDocKind } | { type: "submit" };

/** i18n key of the main button for each step ("Add your details", "Photograph Aadhaar", ..., "Submit for review"). */
export const KYC_STEP_CTA_KEYS: Record<KycStep, string> = {
  details: "kyc.cta.details",
  AADHAAR_FRONT: "kyc.cta.AADHAAR_FRONT",
  AADHAAR_BACK: "kyc.cta.AADHAAR_BACK",
  PAN: "kyc.cta.PAN",
  SELFIE: "kyc.cta.SELFIE",
  review: "kyc.cta.review",
};

/** The main button for the next step: its label key and what pressing it does. */
export function stepCta(step: KycStep): { labelKey: string; action: StepAction } {
  const labelKey = KYC_STEP_CTA_KEYS[step];
  if (step === "details") return { labelKey, action: { type: "details" } };
  if (step === "review") return { labelKey, action: { type: "submit" } };
  return { labelKey, action: { type: "capture", kind: step } };
}

export interface VerifyCard {
  id: KycGroupId;
  /** 1-based position, shown on a card that is still to do. */
  number: number;
  state: KycGroupState;
  titleKey: string;
  subtitleKey: string;
  icon: IconName;
}

const CARD_ICONS: Record<KycGroupId, IconName> = { details: "user", aadhaar: "idCard", pan: "creditCard", selfie: "scanFace" };

/** The four cards of the verify screen, in order, with the state `groupStates` gives each. */
export function verifyCards(p: { detailsComplete: boolean; kycDocuments: readonly string[] }): VerifyCard[] {
  const states = groupStates(p);
  return KYC_GROUPS.map((g, i) => ({
    id: g.id,
    number: i + 1,
    state: states[g.id],
    titleKey: `kyc.card.${g.id}.title`,
    subtitleKey: `kyc.card.${g.id}.sub`,
    icon: CARD_ICONS[g.id],
  }));
}

export type CardPress = { type: "none" } | { type: "details" } | { type: "capture"; kind: KycDocKind } | { type: "chooseSide" };

/**
 * What tapping a card does. A card that is not reachable yet does nothing. Details open the form. The current card
 * opens the camera for its first missing photo. A done card is a retake (a rejection may be about one photo): a
 * single-photo card retakes that photo, and Aadhaar, which has two, asks which side.
 */
export function cardPress(id: KycGroupId, state: KycGroupState, documents: readonly string[]): CardPress {
  if (state === "todo") return { type: "none" };
  if (id === "details") return { type: "details" };
  const kinds = KYC_GROUPS.find((g) => g.id === id)?.kinds ?? [];
  if (state === "current") {
    const missing = kinds.find((k) => !documents.includes(k));
    return missing ? { type: "capture", kind: missing } : { type: "none" };
  }
  if (kinds.length === 1 && kinds[0]) return { type: "capture", kind: kinds[0] };
  return { type: "chooseSide" };
}

/**
 * The text for a failed KYC request (saving the details, submitting for review). offline, the request's own timeout
 * (`timeoutKey`) and any 5xx are translated; a 4xx shows the server's own message (English, accepted for now): the 400
 * naming what is missing, the 409 "already in review or approved".
 */
export function kycRequestErrorText(e: unknown, t: (key: string) => string, timeoutKey: string): string {
  if (e instanceof ApiError) {
    if (e.code === "offline") return t("common.noConnection");
    if (e.code === "timeout") return t(timeoutKey);
    if (e.status >= 400 && e.status < 500 && e.message !== GENERIC_ERROR && e.message.trim() !== "") return e.message;
  }
  return t("common.genericError");
}

/**
 * Whether the main button can be pressed. Submit for review waits for the declaration ("These documents are mine and
 * the details are correct"), as on the web; the server does not check it. Every other step's button is always enabled.
 */
export function submitEnabled(step: KycStep, declared: boolean): boolean {
  return step !== "review" || declared;
}
