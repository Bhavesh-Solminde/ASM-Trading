import Image from "next/image";
import Link from "next/link";

/* --------------------------------------------------------------------------
 * IndianxTrade brand mark — the silver-chrome wordmark with an Indian-flag X.
 * Default source: /brand/indianxtrade-logo-dark.png (near-black background),
 * rendered inside a rounded tile so the dark square reads as an intentional
 * app icon on the site's dark surfaces. A compact IXT variant will replace
 * this file in the tightest slots (nav/topbar/PWA icon) when it lands —
 * paths kept so the swap is a single file replace, no component change.
 * ------------------------------------------------------------------------ */

export function LogoEmblem({
  className,
  title = "IndianxTrade",
  rounded = true,
}: {
  className?: string;
  title?: string;
  rounded?: boolean;
  /** Accepted for call-site compatibility; the raster mark has one form. */
  detail?: boolean;
}) {
  return (
    <span
      className={`relative inline-block overflow-hidden ${rounded ? "rounded-[24%]" : ""} ${className ?? ""}`}
    >
      <Image
        src="/brand/indianxtrade-logo-dark.png"
        alt={title}
        fill
        sizes="(min-width: 768px) 128px, 112px"
        className="object-cover"
        priority
      />
    </span>
  );
}

/**
 * The IndianxTrade horizontal wordmark (raster): silver chrome lettering with
 * an Indian-flag X on a truly transparent background, cropped tight to the
 * art. It was keyed out of the black-backed source
 * (/brand/indianxtrade-wordmark-dark.png, still used for the share card), so
 * it sits on any surface with no box, blend mode or glow. Height is set by the
 * caller via className (e.g. `h-6`); width follows the art's ~3.96:1 ratio.
 */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/indianxtrade-wordmark.png"
      alt="IndianxTrade"
      width={1179}
      height={298}
      priority
      className={`w-auto ${className ?? ""}`}
    />
  );
}

/** Back-compat alias — some call sites import LogoMark for small placements. */
export const LogoMark = LogoEmblem;

/** Full lockup: emblem tile + "IndianxTrade" wordmark. */
export function Logo({
  href = "/",
  className,
}: {
  href?: string;
  /** Retained for call-site compatibility; the wordmark now contains "Trade". */
  showTag?: boolean;
  detail?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={`flex items-center gap-2.5 ${className ?? ""}`} aria-label="IndianxTrade — home">
      <LogoEmblem className="h-9 w-9" />
      <span className="font-brand text-xl font-black leading-none tracking-tight text-brand">
        IndianxTrade
      </span>
    </Link>
  );
}
