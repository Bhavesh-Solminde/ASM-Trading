import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { InteractionManager, Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { applyKey, methodLimits } from "@asm/client-core";
import { USDT_NETWORK_INFO, type UsdtNetwork } from "@asm/contracts";
import { api } from "@/api/client";
import { invalidateMoney, useBootstrap, useDepositConfig } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { useSessionLive } from "@/auth/use-session-live";
import { money, groupTyped } from "@/money/format";
import { amountInWords } from "@/money/words";
import { AmountSheet } from "@/payments/AmountSheet";
import { BonusSheet } from "@/payments/BonusSheet";
import { DEPOSIT_AMOUNT_OPTS, RECOMMENDED_NETWORK, depositBody, depositModel, type DepositMethod, type MethodRow } from "@/payments/deposit-form";
import { CREATE_DEPOSIT_TIMEOUT_MS, createDepositSubmitter } from "@/payments/deposit-submit";
import { savePendingCheckout } from "@/payments/pending-checkout";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { AmountFigure } from "@/ui/AmountFigure";
import { BackHeader } from "@/ui/BackHeader";
import { logoFor } from "@/ui/brand-logos";
import { Chip } from "@/ui/Chip";
import { IconTile } from "@/ui/IconTile";
import { Money } from "@/ui/Money";
import type { SheetRef } from "@/ui/Sheet";
import { StatusTag } from "@/ui/StatusTag";
import { toast } from "@/ui/Toast";

/** The subtitle under a method's name: what it does, why it is off, or which limit the amount breaks. */
function methodSubtitle(row: MethodRow, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (row.state === "soon") return t("deposit.comingSoon");
  if (row.state === "limit" && row.limit) return t(row.limit.kind === "min" ? "deposit.min" : "deposit.max", { amount: money(row.limit.rupees * 100, "INR", { trim: true }) });
  if (row.method === "USDT") return t("deposit.from", { amount: money(methodLimits("USDT").min * 100, "INR", { trim: true }) });
  return t(row.method === "UPI" ? "deposit.pickApp" : "deposit.opensApp");
}

/**
 * Add money: one screen. The amount (a tap opens the keypad sheet, which also opens once on arrival while the amount
 * is empty), the bonus this deposit earns, then how to pay. The CTA creates the deposit (`POST /api/deposits`, a
 * money-moving POST: 15s timeout, one tap at a time, never retried) and replaces this screen with the pay screen.
 * Deposits always credit the LIVE account.
 */
export default function Deposit() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);
  const boot = useBootstrap(!!token).data;
  const sessionLive = useSessionLive();
  const config = useDepositConfig(sessionLive);
  const [amount, setAmount] = useState("");
  const [pickedMethod, setPickedMethod] = useState<DepositMethod | null>(null);
  const [pickedNetwork, setPickedNetwork] = useState<UsdtNetwork | null>(null);
  const [busy, setBusy] = useState(false);
  const amountSheet = useRef<SheetRef>(null);
  const bonusSheet = useRef<SheetRef>(null);

  // The submitter is built once (its in-flight flag must survive re-renders); it reads the latest `t` and user from here.
  const latest = useRef({ t, userId: boot?.userId });
  latest.current = { t, userId: boot?.userId };
  const submitter = useRef<ReturnType<typeof createDepositSubmitter> | null>(null);
  if (submitter.current === null) {
    submitter.current = createDepositSubmitter({
      post: (body) => api("/api/deposits", { method: "POST", body, timeoutMs: CREATE_DEPOSIT_TIMEOUT_MS }),
      savePending: (checkoutToken) => {
        const userId = latest.current.userId;
        if (userId) savePendingCheckout(userId, { token: checkoutToken, expiresAt: null, amountInr: null });
      },
      invalidateMoney,
      navigate: (checkoutToken) => router.replace({ pathname: "/payments/pay/[token]", params: { token: checkoutToken } }),
      toast,
      session: () => useSession.getState().token,
      setBusy,
      t: (key, options) => latest.current.t(key, options),
    });
  }

  // Open the keypad once when the screen is ready and no amount is entered; never again (a dismissed sheet stays dismissed).
  const configReady = !!config.data;
  const autoOpened = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!configReady || autoOpened.current) return;
    autoOpened.current = true;
    void InteractionManager.runAfterInteractions(() => {
      if (mounted.current) amountSheet.current?.present();
    });
  }, [configReady]);

  const header = <BackHeader title={t("deposit.title")} />;
  if (!config.data) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 20 }}>
          {header}
          {config.isError ? (
            <View style={{ gap: 12 }}>
              <Txt color={color.ink2}>{t("common.genericError")}</Txt>
              <Button label={t("common.retry")} kind="secondary" onPress={() => void config.refetch()} />
            </View>
          ) : (
            <View accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} style={{ gap: 12 }}>
              <Skeleton height={96} />
              <Skeleton height={56} />
              <Skeleton height={240} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  const model = depositModel(config.data, { amountText: amount, method: pickedMethod, network: pickedNetwork });
  const locale = i18n.language.startsWith("hi") ? "hi" : "en";
  const figure = `₹ ${groupTyped(amount, "INR")}`;
  const words = model.rupees > 0 ? amountInWords(model.rupees, locale) : t("deposit.tapToEnter");
  const methodName = model.method ? t(`deposit.method.${model.method}`) : "";
  const ctaLabel = model.method && model.rupees > 0 ? t("deposit.payWith", { amount: money(model.rupees * 100, "INR", { trim: true }), method: methodName }) : t("deposit.enterAmount");
  const networks = config.data.usdtNetworks;

  const pay = () => {
    if (!model.canPay || !model.method || busy) return;
    let body;
    try {
      body = depositBody(model.method, model.rupees, model.network ?? undefined);
    } catch {
      toast(t("common.genericError"), "down");
      return;
    }
    void submitter.current?.(body);
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>{header}</View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 20 }}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Txt size={14} color={color.ink3} style={{ flex: 1 }}>
                {t("deposit.amount")}
              </Txt>
              <Txt size={13} color={color.up} style={{ flexShrink: 0 }}>
                {t("trade.liveAccount")}
              </Txt>
            </View>
            <AmountFigure testID="deposit-amount" text={figure} words={words} onPress={() => amountSheet.current?.present()} />
            {model.problem ? (
              <Txt size={13} color={color.downText} accessibilityLiveRegion="polite" testID="deposit-problem">
                {t(model.problem.kind === "min" ? "deposit.min" : "deposit.max", { amount: money(model.problem.rupees * 100, "INR", { trim: true }) })}
              </Txt>
            ) : null}
          </View>

          {model.bonus ? (
            <View style={{ gap: 4 }}>
              <View
                testID="deposit-bonus"
                accessible
                accessibilityLabel={`${t("deposit.bonusRow", { nth: t(`deposit.nth${model.bonus.nth}`), pct: model.bonus.pct })}${model.bonus.bonusMinor > 0 ? `, +${money(model.bonus.bonusMinor, "INR")}` : ""}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: color.ruleSoft, backgroundColor: color.raised }}
              >
                <Txt size={15} color={color.gold} style={{ flex: 1 }}>
                  {t("deposit.bonusRow", { nth: t(`deposit.nth${model.bonus.nth}`), pct: model.bonus.pct })}
                </Txt>
                {model.bonus.bonusMinor > 0 ? (
                  <Money text={`+${money(model.bonus.bonusMinor, "INR")}`} size={15} weight={600} color={color.gold} style={{ flexShrink: 0 }} />
                ) : null}
              </View>
              <Txt size={13} color={color.ink2} style={{ paddingTop: 4 }}>
                {t("deposit.bonusNote")}
              </Txt>
              <Pressable testID="deposit-how-it-works" accessibilityRole="link" onPress={() => bonusSheet.current?.present()} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
                <Txt size={14} weight={600} color={color.accentText}>
                  {t("deposit.howItWorks")}
                </Txt>
              </Pressable>
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            <Txt size={14} weight={500} color={color.ink3} accessibilityRole="header">
              {t("deposit.payWithHeading")}
            </Txt>
            <View accessibilityRole="radiogroup" accessibilityLabel={t("deposit.payWithHeading")} style={{ borderWidth: 1, borderColor: color.ruleSoft, borderRadius: 14, backgroundColor: color.surface, overflow: "hidden" }}>
              {model.rows.map((row, i) => {
                const selected = row.method === model.method;
                const off = row.state !== "ok";
                const name = t(`deposit.method.${row.method}`);
                const subtitle = methodSubtitle(row, t);
                return (
                  <Pressable
                    key={row.method}
                    testID={`deposit-method-${row.method}`}
                    accessibilityRole="radio"
                    accessibilityLabel={`${name}, ${subtitle}`}
                    accessibilityState={{ checked: selected, disabled: off }}
                    disabled={off}
                    onPress={() => setPickedMethod(row.method)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 66, paddingVertical: 12, paddingHorizontal: 14, opacity: off ? 0.6 : 1, borderBottomWidth: i === model.rows.length - 1 ? 0 : 1, borderBottomColor: color.ruleSoft }}
                  >
                    <IconTile size={42} logo={logoFor(row.method)} />
                    <View style={{ flex: 1 }}>
                      <Txt size={16} weight={600} numberOfLines={2}>
                        {name}
                      </Txt>
                      <Txt size={13} color={color.ink3}>
                        {subtitle}
                      </Txt>
                    </View>
                    <View style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, borderWidth: selected ? 7 : 1.5, borderColor: selected ? color.accent : color.rule }} />
                  </Pressable>
                );
              })}
            </View>
          </View>

          {model.method === "USDT" && networks.length > 1 ? (
            <View style={{ gap: 8 }}>
              <Txt size={14} weight={500} color={color.ink3} accessibilityRole="header">
                {t("deposit.network")}
              </Txt>
              <View accessibilityRole="radiogroup" accessibilityLabel={t("deposit.network")} style={{ gap: 8 }}>
                {networks.map((n) => (
                  <View key={n} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <Chip testID={`deposit-network-${n}`} role="radio" label={USDT_NETWORK_INFO[n].shortLabel} selected={model.network === n} onPress={() => setPickedNetwork(n)} />
                    {n === RECOMMENDED_NETWORK ? <StatusTag tone="up" label={t("deposit.recommended")} /> : null}
                  </View>
                ))}
              </View>
              <Txt size={13} color={color.ink2}>
                {t("deposit.networkHint")}
              </Txt>
            </View>
          ) : null}
        </ScrollView>

        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 + insets.bottom }}>
          <Button testID="deposit-pay" kind="light" label={ctaLabel} disabled={!model.canPay} busy={busy} onPress={pay} />
        </View>
      </View>

      <AmountSheet
        ref={amountSheet}
        value={amount}
        quick={model.quick}
        onKey={(key) => setAmount((current) => applyKey(current, key, DEPOSIT_AMOUNT_OPTS))}
        onPreset={setAmount}
      />
      <BonusSheet ref={bonusSheet} completedDeposits={config.data.completedDeposits} />
    </Screen>
  );
}
