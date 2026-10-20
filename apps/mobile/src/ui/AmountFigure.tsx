import { Pressable, View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Money } from "./Money";

/**
 * The flow screens' big amount: a 40/600 figure that shrinks to fit one line (it never wraps or clips), then the
 * amount in words in 14 `ink2`. Tappable when `onPress` is given (it opens the amount sheet); at least 44pt tall.
 */
export function AmountFigure({ text, words, onPress, testID }: { text: string; words?: string; onPress?: () => void; testID?: string }) {
  const body = (
    <View style={{ minHeight: 44, width: "100%", justifyContent: "center", gap: 4 }}>
      <Money text={text} size={40} weight={600} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} lineHeight={48} />
      {words ? <Txt size={14} color={color.ink2}>{words}</Txt> : null}
    </View>
  );
  if (!onPress) return <View testID={testID} accessible accessibilityLabel={words ? `${text}, ${words}` : text}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={words ? `${text}, ${words}` : text} onPress={onPress}>
      {body}
    </Pressable>
  );
}
