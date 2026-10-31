/**
 * Meta Pixel IDs for the landing / login / register pages (see
 * components/seo/MetaPixel). META_PIXEL_ID holds one ID or a comma-separated
 * list, so several ad accounts can track the same pages. Read at request time
 * so the IDs can change in .env.production with a container recreate instead
 * of a rebuild. Unset → [] → the pixel never loads.
 */
export function metaPixelIds(): string[] {
  return validPixelIds(process.env.META_PIXEL_ID);
}

/**
 * Pixel IDs are numeric; anything else is a misconfiguration, not an ID, and
 * is dropped. Whitespace around commas is tolerated; duplicates collapse.
 */
export function validPixelIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = raw.split(",").map((id) => id.trim());
  return [...new Set(ids.filter((id) => /^\d{6,20}$/.test(id)))];
}
