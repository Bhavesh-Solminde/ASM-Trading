import Image from "next/image";
import Link from "next/link";

/* --------------------------------------------------------------------------
 * ASM brand mark — the generated bull/arrow/chart emblem.
 * Source art lives at /brand/asm-logo.png (dark-background raster); we render
 * it inside a rounded tile so the dark square reads as an intentional app icon
 * on the site's dark surfaces.
 * ------------------------------------------------------------------------ */

export function LogoEmblem({
  className,
  title = "ASM Trade",
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
        src="/brand/asm-logo.png"
        alt={title}
        fill
        sizes="(min-width: 768px) 128px, 112px"
        className="object-cover"
        priority
      />
    </span>
  );
}

/** Back-compat alias — some call sites import LogoMark for small placements. */
export const LogoMark = LogoEmblem;

/** Full lockup: emblem tile + "ASM" wordmark + optional "Trade" tag. */
export function Logo({
  href = "/",
  showTag = true,
  className,
}: {
  href?: string;
  showTag?: boolean;
  detail?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={`flex items-center gap-2.5 ${className ?? ""}`} aria-label="ASM Trade — home">
      <LogoEmblem className="h-9 w-9" />
      <span className="flex items-baseline gap-1.5">
        <span className="font-brand text-2xl font-black leading-none tracking-wide text-brand">ASM</span>
        {showTag ? <span className="text-sm font-semibold text-ink-2">Trade</span> : null}
      </span>
    </Link>
  );
}
