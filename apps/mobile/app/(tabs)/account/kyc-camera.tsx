import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { CaptureScreen } from "@/kyc/CaptureScreen";
import { captureKind } from "@/kyc/capture-model";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";

/** KYC camera for one photo: `/account/kyc-camera?kind=AADHAAR_FRONT|AADHAAR_BACK|PAN|SELFIE`. An unknown kind has no camera to open. */
export default function KycCamera() {
  const { t } = useTranslation();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const docKind = captureKind(kind);
  if (!docKind) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 16 }}>
          <Txt color={color.ink2}>{t("kyc.badLink")}</Txt>
          <Button testID="kyc-bad-link-back" kind="secondary" label={t("common.back")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/account/verify"))} />
        </View>
      </Screen>
    );
  }
  return <CaptureScreen kind={docKind} />;
}
