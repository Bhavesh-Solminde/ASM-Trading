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
 * The IndianxTrade horizontal wordmark (raster). The source art is silver
 * chrome lettering with an Indian-flag X on a near-black background, so we
 * composite it with `mix-blend-mode: screen`: against the site's dark
 * surfaces the black drops out and only the metallic wordmark + flag colours
 * show, no matter the exact surface colour. Height is set by the caller via
 * className (e.g. `h-6`); width follows the art's aspect ratio (~3.06:1).
 */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/indianxtrade-wordmark-dark.png"
      alt="IndianxTrade"
      width={1254}
      height={410}
      priority
      className={`w-auto [mix-blend-mode:screen] ${className ?? ""}`}
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
