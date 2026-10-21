import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { Circle, Svg } from "react-native-svg";
import type { CheckoutView } from "@asm/contracts";
import { money } from "@/money/format";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { logoFor } from "@/ui/brand-logos";
import { Icon } from "@/ui/Icon";
import { IconTile } from "@/ui/IconTile";
import { toast } from "@/ui/Toast";
import { BUTTON_SKIN } from "@/theme/button-skin";
import { ClaimLink } from "./ClaimLink";
import { detectInstalledUpiApps, openUpiApp } from "./open-upi";
import { statusLineKey } from "./pay-model";
import { buttonPlan, orderUpiApps, upiAppName, type NamedUpiApp, type UpiApp } from "./upi-apps";

/**
 * Apps the operator has switched off (`UPI_APP_BLOCKLIST`, for an app that rejects payments to a new merchant).
 * T9 fills this from the app config; `orderUpiApps` already takes it.
 */
const UPI_APP_BLOCKLIST: readonly string[] = [];

/** The button's words: "Open PhonePe", "Open UPI app"; or, in the grid, the bare app name ("Google Pay", "Other apps"). */
function appLabel(app: UpiApp, big: boolean, t: (key: string, options?: Record<string, unknown>) => string): string {
  const name = upiAppName(app);
  if (big) return name ? t("pay.openApp", { app: name }) : t("pay.openUpiApp");
  return name ?? t("pay.otherApps");
}

function AppButton({ app, big, onPress }: { app: UpiApp; big: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const skin = BUTTON_SKIN[big ? "light" : "secondary"];
  const label = appLabel(app, big, t);
  return (
    <Pressable
      testID={`pay-app-${app}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: big ? 54 : 50,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: skin.border,
        backgroundColor: skin.bg,
        opacity: pressed ? 0.85 : 1,
        ...(big ? null : { flexBasis: "47%", flexGrow: 1 }),
      })}
    >
      <IconTile size={36} logo={logoFor(app)} />
      <Txt size={big ? 17 : 15} weight={600} color={skin.ink} numberOfLines={2} style={{ flexShrink: 1, textAlign: "center" }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** A 30% arc over a rule-coloured ring: "we are waiting", as on the board. Decorative. */
function WaitingRing() {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Circle cx={11} cy={11} r={r} stroke={color.rule} strokeWidth={3} fill="none" />
      <Circle cx={11} cy={11} r={r} stroke={color.accentText} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${c * 0.3} ${c}`} rotation={-90} origin="11, 11" />
    </Svg>
  );
}

/** The scannable card: dark modules on `paper`, 196 square with 12 padding. Falls back to nothing if the code cannot be drawn. */
function QrCard({ value }: { value: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t("pay.qrLabel")} style={{ width: 196, minHeight: 196, padding: 12, borderRadius: 14, backgroundColor: color.paper }}>
      <QRCode value={value} size={172} color={color.ground} backgroundColor={color.paper} quietZone={0} ecl="M" onError={() => setFailed(true)} />
    </View>
  );
}

/**
 * The open UPI payment: scan the QR or hand it to a UPI app, copy the UPI ID, and a status card that says what we
 * are waiting for. The apps are the installed ones among PhonePe / Google Pay / Paytm (a probe each), the method the
 * user picked first, then the system chooser; a phone with none still gets the chooser. Polling lives in the screen.
 */
export function UpiPay({ view, token }: { view: CheckoutView; token: string }) {
  const { t } = useTranslation();
  const [installed, setInstalled] = useState<NamedUpiApp[] | null>(null);
  useEffect(() => {
    let alive = true;
    void detectInstalledUpiApps((url) => Linking.canOpenURL(url)).then((apps) => {
      if (alive) setInstalled(apps);
    });
    return () => {
      alive = false;
    };
  }, []);
  const ordered = useMemo(() => (installed ? orderUpiApps(installed, view.method, UPI_APP_BLOCKLIST) : null), [installed, view.method]);
  const plan = ordered ? buttonPlan(ordered) : null;
  const upiUri = view.upiUri;
  const vpa = view.vpa;
  const line = statusLineKey(view.status);

  const open = (app: UpiApp) => void openUpiApp(app, upiUri, { openURL: (url) => Linking.openURL(url), toast, t });
  const copy = async () => {
    if (!vpa) return;
    try {
      await Clipboard.setStringAsync(vpa);
      toast(t("pay.copied"), "up");
    } catch {
      toast(t("common.genericError"), "down");
    }
  };

  return (
    <View style={{ gap: 22 }}>
      <View style={{ alignItems: "center", gap: 12 }}>
        {upiUri ? <QrCard value={upiUri} /> : null}
        <Txt size={14} color={color.ink2} style={{ textAlign: "center" }}>
          {t("pay.scanHint")}
        </Txt>
        {vpa ? (
          <Pressable
            testID="pay-copy-vpa"
            accessibilityRole="button"
            accessibilityLabel={t("pay.copyId", { vpa })}
            onPress={() => void copy()}
            style={{ minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: color.rule }}
          >
            <Txt font="fig" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
              {vpa}
            </Txt>
            <Icon name="copy" size={16} color={color.accentText} />
          </Pressable>
        ) : null}
        <Txt size={13} color={color.ink2} style={{ textAlign: "center" }}>
          {t("pay.exactAmount", { amount: money(view.amountInr, "INR") })}
        </Txt>
      </View>

      <View style={{ gap: 10 }}>
        {plan ? (
          <>
            <AppButton app={plan.primary} big onPress={() => open(plan.primary)} />
            {plan.rest.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {plan.rest.map((app) => (
                  <AppButton key={app} app={app} big={false} onPress={() => open(app)} />
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <View accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} style={{ minHeight: 54, borderRadius: 12, backgroundColor: color.raised }} />
        )}
      </View>

      {line ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, padding: 16, borderRadius: 14, backgroundColor: color.surface }}>
          <WaitingRing />
          <Txt testID="pay-status" accessibilityLiveRegion="polite" size={14} color={color.ink2} style={{ flex: 1 }}>
            {t(line)}
          </Txt>
        </View>
      ) : null}
      <ClaimLink token={token} depositId={view.id} status={view.status} claimedUtr={view.claimedUtr} delaySec={view.manualClaimDelaySec} />
    </View>
  );
}
