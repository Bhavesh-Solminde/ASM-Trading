/**
 * Meta Pixel ID for the landing / login / register pages (see
 * components/seo/MetaPixel). Read at request time so the ID can change in
 * .env.production with a container recreate instead of a rebuild. Unset or
 * malformed → null → the pixel never loads.
 */
export function metaPixelId(): string | null {
  return validPixelId(process.env.META_PIXEL_ID);
}

/** Pixel IDs are numeric; anything else is a misconfiguration, not an ID. */
export function validPixelId(id: string | undefined): string | null {
  return id && /^\d{6,20}$/.test(id) ? id : null;
}
