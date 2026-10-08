/** Preset KYC rejection reasons, shown to the user on their verify page. */
export const KYC_REJECT_REASONS = [
  "A photo is blurry, cropped or unreadable",
  "The name doesn't match the documents",
  "The document is expired or not valid",
  "The selfie doesn't match the ID photo",
  "A document is missing",
] as const;
