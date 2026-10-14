import type { ViewStyle } from "react-native";

/**
 * Top padding for a screen: the style's own (`paddingTop`, else `padding`) plus the offline strip's height while
 * the strip shows, so the strip never covers the first row of content. The safe-area inset is added natively.
 */
export function screenTopPadding(style: ViewStyle | undefined, bannerVisible: boolean, bannerHeight: number): number {
  const own = typeof style?.paddingTop === "number" ? style.paddingTop : typeof style?.padding === "number" ? style.padding : 0;
  return own + (bannerVisible ? bannerHeight : 0);
}
