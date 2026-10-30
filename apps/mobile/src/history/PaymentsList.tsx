import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { RefreshControl, SectionList, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { PaymentRow } from "@asm/client-core";
import { paymentRows } from "@/api/payment-rows";
import { usePaymentsInfinite } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { color } from "@/theme/tokens";
import { Button, Skeleton, Txt } from "@/theme/ui";
import { ListState } from "@/ui/ListState";
import { PaymentListRow } from "@/ui/PaymentListRow";
import { headingText } from "./format";
import type { PaymentsFilter } from "./history-params";
import { paymentSections, shouldLoadMore, type PaymentSection } from "./payment-sections";

/**
 * The Payments segment of History: deposits and withdrawals from the shared infinite payments query, grouped by day, newest
 * first. It refetches on focus and on pull, loads the next page on reaching the end (and on its own when a filter leaves
 * too few rows to scroll), and shows the loading, error, empty and "couldn't load more" states. A row opens its detail sheet.
 */
export function PaymentsList({ header, filter, onOpen }: { header: ReactElement; filter: PaymentsFilter; onOpen: (key: string) => void }) {
  const { t } = useTranslation();
  const live = useSessionLive();
  const query = usePaymentsInfinite(live);
  const { refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = query;
  const [refreshing, setRefreshing] = useState(false);

  // Never cancel a request already in flight (the first focus lands while the mount fetch is running); nothing fetches
  // while locked or signed out (`refetch` ignores `enabled`, so the gate is here).
  useFocusEffect(useCallback(() => {
    if (live) void refetch({ cancelRefetch: false });
  }, [live, refetch]));

  const sections = useMemo(() => paymentSections(paymentRows(query.data), filter, new Date()), [query.data, filter]);
  const shown = sections.reduce((n, s) => n + s.data.length, 0);

  useEffect(() => {
    if (shouldLoadMore({ hasNextPage, fetching: isFetchingNextPage, failed: isFetchNextPageError, shown, reason: "short" })) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, shown, fetchNextPage]);

  const refresh = async () => {
    if (!live) return;
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const noRows = sections.length === 0;
  const hasAnyRows = query.data !== undefined;
  const moreComing = hasNextPage && !isFetchNextPageError;
  const emptyText = filter === "deposits" ? t("history.empty.deposits") : filter === "withdrawals" ? t("history.empty.withdrawals") : t("redesign.noPayments");

  return (
    <SectionList<PaymentRow, PaymentSection>
      testID="history-payments-list"
      sections={sections}
      keyExtractor={(row) => row.key}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => (
        <Txt size={13} weight={600} color={color.ink2} accessibilityRole="header" style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 2 }}>
          {headingText(t, section.heading)}
        </Txt>
      )}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 20 }}>
          <PaymentListRow row={item} testID={`history-tx-${item.key}`} onPress={() => onOpen(item.key)} />
        </View>
      )}
      ListEmptyComponent={
        <View style={{ paddingHorizontal: 20 }}>
          <ListState
            loading={query.isPending || (hasAnyRows && noRows && moreComing)}
            error={query.isError && !hasAnyRows}
            empty={hasAnyRows && noRows && !hasNextPage ? emptyText : undefined}
            onRetry={() => void refetch()}
          />
        </View>
      }
      ListFooterComponent={
        <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 12 }}>
          {isFetchingNextPage ? <Skeleton height={54} /> : null}
          {isFetchNextPageError && !isFetchingNextPage ? (
            <View testID="history-load-more-failed" style={{ gap: 8 }}>
              <Txt color={color.ink2}>{t("history.loadMoreFailed")}</Txt>
              <Button label={t("common.retry")} kind="secondary" onPress={() => void fetchNextPage()} />
            </View>
          ) : null}
        </View>
      }
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (shouldLoadMore({ hasNextPage, fetching: isFetchingNextPage, failed: isFetchNextPageError, shown, reason: "end" })) void fetchNextPage();
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.accentText} colors={[color.accent]} />}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  );
}
