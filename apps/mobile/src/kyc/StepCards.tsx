import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import { IconTile } from "@/ui/IconTile";
import type { VerifyCard } from "./verify-model";

/**
 * The four verification steps as rows on one `surface` card (R2 "Verify identity"): an icon tile, the title and what
 * it needs, and the state on the right: a green check when done, "Next" on the step to do now, the step number
 * otherwise. A row that is not reachable yet is disabled. Title and subtitle take the room (`flex: 1`) so a long
 * Hindi line wraps inside its row; the state never shrinks. Rows are at least 72pt tall.
 */
export function StepCards({ cards, onPress }: { cards: VerifyCard[]; onPress: (card: VerifyCard) => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ backgroundColor: color.surface, borderRadius: 14, paddingHorizontal: 14, overflow: "hidden" }}>
      {cards.map((card, i) => {
        const stateText = card.state === "done" ? t("kyc.done") : card.state === "current" ? t("kyc.next") : String(card.number);
        const title = t(card.titleKey);
        const subtitle = t(card.subtitleKey);
        const disabled = card.state === "todo";
        return (
          <Pressable
            key={card.id}
            testID={`verify-card-${card.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${subtitle}. ${stateText}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onPress(card)}
            style={({ pressed }) => ({
              minHeight: 72,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 14,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: color.ruleSoft,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <IconTile icon={card.icon} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt size={16} weight={600}>
                {title}
              </Txt>
              <Txt size={14} color={color.ink2}>
                {subtitle}
              </Txt>
            </View>
            <View style={{ flexShrink: 0, minWidth: 36, alignItems: "flex-end", justifyContent: "center" }}>
              {card.state === "done" ? (
                <Icon name="check" size={22} color={color.up} strokeWidth={2.4} />
              ) : (
                <Txt size={14} weight={600} color={card.state === "current" ? color.accentText : color.ink3}>
                  {stateText}
                </Txt>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
