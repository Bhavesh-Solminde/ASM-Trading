import { Image, View, type ImageSourcePropType } from "react-native";
import { color } from "@/theme/tokens";
import { Icon, type IconName } from "./Icon";

/**
 * A square tile for a payment row or a list row. A brand `logo` always sits on a white tile (the logos are drawn for
 * one); an `icon` sits on `raised`, or on `paper` with a dark glyph when `light`. Decorative: the row carries the label.
 */
export function IconTile({ size = 42, logo, icon, light = false }: { size?: 42 | 36; logo?: ImageSourcePropType; icon?: IconName; light?: boolean }) {
  const pale = !!logo || light;
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: logo ? "#ffffff" : light ? color.paper : color.raised, flexShrink: 0 }}
    >
      {logo ? (
        <Image source={logo} accessible={false} accessibilityIgnoresInvertColors resizeMode="contain" style={{ width: size * 0.64, height: size * 0.64 }} />
      ) : icon ? (
        <Icon name={icon} size={Math.round(size * 0.5)} color={pale ? color.ground : color.ink2} />
      ) : null}
    </View>
  );
}
