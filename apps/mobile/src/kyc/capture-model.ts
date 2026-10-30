import { KYC_DOCS, type KycDocKind } from "./kyc-flow";

/** The `kind` route param as a document kind: the first value of a repeated param, else null for anything unknown. */
export function captureKind(param: string | readonly string[] | undefined): KycDocKind | null {
  const raw = Array.isArray(param) ? param[0] : param;
  return KYC_DOCS.find((k) => k === raw) ?? null;
}

/** Documents are photographed with the back camera, the selfie with the front one. */
export function cameraFacing(kind: KycDocKind): "front" | "back" {
  return kind === "SELFIE" ? "front" : "back";
}

/** The torch helps with a card in poor light; a selfie has none. */
export function torchAvailable(kind: KycDocKind): boolean {
  return kind !== "SELFIE";
}

export const captureTitleKey = (kind: KycDocKind): string => `kyc.doc.${kind}`;
export const captureHintKey = (kind: KycDocKind): string => (kind === "SELFIE" ? "kyc.selfieHint" : "kyc.cardHint");

export type PermissionView = "loading" | "ready" | "ask" | "settings";

/**
 * What the camera screen shows for the camera permission: nothing yet while it is being read, the camera once
 * granted, the system dialog while it can still show, and "Open settings" after a permanent denial (Android shows
 * the dialog at most twice).
 */
export function permissionView(perm: { granted: boolean; canAskAgain: boolean } | null): PermissionView {
  if (!perm) return "loading";
  if (perm.granted) return "ready";
  return perm.canAskAgain ? "ask" : "settings";
}

export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  x: number;
  y: number;
}
export interface GuideBox extends Rect {
  radius: number;
  shape: "card" | "oval";
}

const CARD_RATIO = 1.586;
const CARD_INSET = 28;
const SELFIE_SIZE: Size = { width: 220, height: 290 };

/** Where the guide's centre sits, as a share of the area's height: a little above the middle, as on the board. */
const CENTRE_Y = 0.4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The framing guide in `area`: an ID-card rectangle (28 in from each side) or the selfie oval, centred across and 40%
 * of the way down. It never leaves the area: a very short one shrinks the card, keeping its ratio.
 */
export function guideBox(kind: KycDocKind, area: Size): GuideBox {
  if (kind === "SELFIE") {
    const width = Math.min(SELFIE_SIZE.width, area.width);
    const height = Math.min(SELFIE_SIZE.height, area.height);
    return { x: (area.width - width) / 2, y: clamp(area.height * CENTRE_Y - height / 2, 0, area.height - height), width, height, radius: 145, shape: "oval" };
  }
  const width = Math.max(0, Math.min(area.width - CARD_INSET * 2, area.height * CARD_RATIO));
  const height = width / CARD_RATIO;
  return { x: (area.width - width) / 2, y: clamp(area.height * CENTRE_Y - height / 2, 0, area.height - height), width, height, radius: 14, shape: "card" };
}

/** The dimmed area around a hole, as four rects (top, bottom, left, right): React Native has no huge box-shadow to cut one out. */
export function scrimRects(hole: Rect, area: Size): [Rect, Rect, Rect, Rect] {
  return [
    { x: 0, y: 0, width: area.width, height: hole.y },
    { x: 0, y: hole.y + hole.height, width: area.width, height: area.height - hole.y - hole.height },
    { x: 0, y: hole.y, width: hole.x, height: hole.height },
    { x: hole.x + hole.width, y: hole.y, width: area.width - hole.x - hole.width, height: hole.height },
  ];
}
