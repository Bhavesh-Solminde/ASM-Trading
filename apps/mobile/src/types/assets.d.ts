// Metro resolves image imports to an asset id usable as an <Image source>.
declare module "*.png" {
  import type { ImageSourcePropType } from "react-native";
  const source: ImageSourcePropType;
  export default source;
}
