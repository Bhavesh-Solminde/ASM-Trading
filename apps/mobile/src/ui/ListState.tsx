import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Button, Skeleton, Txt } from "@/theme/ui";
import { listStateKind } from "./list-state";

/**
 * What a list shows when it has no rows to show: skeleton rows while loading, a message with a secondary Retry on
 * an error, or `empty` text when the caller passes it (pass it only when the list really is empty). Renders nothing
 * otherwise, so a screen can place it above its rows unconditionally.
 */
export function ListState({
  loading,
  error,
  empty,
  onRetry,
  rows = 3,
}: {
  loading: boolean;
  error: boolean;
  empty?: string;
  onRetry?: () => void;
  rows?: number;
}) {
  const { t } = useTranslation();
  const kind = listStateKind({ loading, error, empty });
  if (kind === "loading") {
    return (
      <View accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} style={{ gap: 12, paddingVertical: 8 }}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} height={54} />
        ))}
      </View>
    );
  }
  if (kind === "error") {
    return (
      <View style={{ gap: 12, paddingVertical: 8 }}>
        <Txt color={color.ink2}>{t("common.genericError")}</Txt>
        {onRetry ? <Button label={t("common.retry")} kind="secondary" onPress={onRetry} /> : null}
      </View>
    );
  }
  if (kind === "empty") return <Txt color={color.ink2} style={{ paddingVertical: 24 }}>{empty}</Txt>;
  return null;
}
