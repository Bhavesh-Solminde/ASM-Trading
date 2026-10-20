import { Image, View } from "react-native";
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

/**
 * The chrome "INDIAN X TRADE" wordmark (750×246). The file is opaque near-black (no alpha), a hair darker than the
 * page, which left a visible box. The `lighten` blend keeps the lighter of image and page per pixel, so the
 * black ground becomes the page colour and only the chrome letters show. (A true transparent asset would be
 * cleaner: see the fix-F report.)
 */
export function Wordmark({ width }: { width: number }) {
  return (
    <View style={{ width, height: (width * 246) / 750, mixBlendMode: "lighten" }}>
      <Image
        source={wordmarkSrc}
        accessible
        accessibilityRole="image"
        accessibilityLabel="IndianxTrade"
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        style={{ width, height: (width * 246) / 750 }}
      />
    </View>
  );
}
