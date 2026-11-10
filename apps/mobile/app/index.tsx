import { View } from "react-native";
import { color } from "@/theme/tokens";

/**
 * Entry route. Renders only the ground colour: the gatekeeper decides where "/" goes (login, lock,
 * a gate screen or /trade), so no tab screen mounts before the session and lock state are known.
 */
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: color.ground }} />;
}
