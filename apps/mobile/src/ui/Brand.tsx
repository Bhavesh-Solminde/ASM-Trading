import { Image } from "react-native";
import markSrc from "../../assets/brand/mark.webp";
import wordmarkSrc from "../../assets/brand/wordmark.webp";

/** The IXT tricolour mark (175×120 source). Decorative: the screen title names the app. */
export function BrandMark({ width }: { width: number }) {
  return (
    <Image
      source={markSrc}
      accessible={false}
      importantForAccessibility="no"
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      style={{ width, height: (width * 120) / 175 }}
    />
  );
}

/** Pixel size of the wordmark file (assets/brand/wordmark.webp, a transparent RGBA export), for its aspect ratio. */
const WORDMARK = { w: 750, h: 190 } as const;

/**
 * The chrome "INDIAN X TRADE" wordmark. The file has real transparency (see assets/brand/README.md), so it sits on the
 * page colour with no box and needs no blend mode.
 */
export function Wordmark({ width }: { width: number }) {
  return (
    <Image
      source={wordmarkSrc}
      accessible
      accessibilityRole="image"
      accessibilityLabel="IndianxTrade"
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      style={{ width, height: (width * WORDMARK.h) / WORDMARK.w }}
    />
  );
}
