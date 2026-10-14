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

/** The chrome "INDIAN X TRADE" wordmark (750×246, black ground that disappears on the #06080b ground). */
export function Wordmark({ width }: { width: number }) {
  return (
    <Image
      source={wordmarkSrc}
      accessible
      accessibilityRole="image"
      accessibilityLabel="IndianxTrade"
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      style={{ width, height: (width * 246) / 750 }}
    />
  );
}
