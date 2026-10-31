import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { shouldRefetchOnFocus } from "@/api/focus-refetch";
import { useProfile } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { DetailsForm } from "@/kyc/DetailsForm";
import { detailsEditable } from "@/kyc/verify-model";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { FormScroll } from "@/ui/form";

/**
 * KYC details: the seven identity fields on one form (`DetailsForm`). The server freezes them while a submission is
 * in review or approved (409), so then this screen shows why instead of a form. Route: `/account/kyc-details`.
 */
export default function KycDetails() {
  const { t } = useTranslation();
  const sessionLive = useSessionLive();
  const profile = useProfile(sessionLive);
  const { refetch, dataUpdatedAt } = profile;
  // Stale data could still say "editable" after the admin decided: refetch on focus once it is stale. The age is read
  // from a ref so a refetch landing does not re-run the effect.
  const updatedAt = useRef(dataUpdatedAt);
  updatedAt.current = dataUpdatedAt;
  useFocusEffect(
    useCallback(() => {
      if (shouldRefetchOnFocus({ live: sessionLive, dataUpdatedAt: updatedAt.current, now: Date.now() })) void refetch({ cancelRefetch: false });
    }, [sessionLive, refetch]),
  );

  const data = profile.data;
  return (
    <Screen>
      <FormScroll top>
        <View style={{ padding: 20, gap: 20 }}>
          <BackHeader title={t("kyc.detailsTitle")} />
          {data ? (
            detailsEditable(data.kycStatus) ? (
              <DetailsForm profile={data} />
            ) : (
              <Txt testID="kyc-details-locked" size={15} color={color.ink2}>
                {t("kyc.detailsLocked")}
              </Txt>
            )
          ) : profile.isError ? (
            <View style={{ gap: 12 }}>
              <Txt color={color.ink2}>{t("common.genericError")}</Txt>
              <Button testID="kyc-details-retry" label={t("common.retry")} kind="secondary" onPress={() => void refetch()} />
            </View>
          ) : (
            <View accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} style={{ gap: 12 }}>
              <Skeleton height={52} />
              <Skeleton height={52} />
              <Skeleton height={52} />
            </View>
          )}
        </View>
      </FormScroll>
    </Screen>
  );
}
