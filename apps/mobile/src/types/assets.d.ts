// Metro resolves image imports to an asset id usable as an <Image source>.
declare module "*.png" {
  import type { ImageSourcePropType } from "react-native";
  const source: ImageSourcePropType;
  export default source;
}

// Metro asset ids: usable as an <Image source>, a Skia useImage()/useFont() source, or an expo-font source.
declare module "*.webp" {
  const id: number;
  export default id;
}
declare module "*.ttf" {
  const id: number;
  export default id;
}
declare module "*.jpg" {
  import type { ImageSourcePropType } from "react-native";
  const source: ImageSourcePropType;
  export default source;
}
