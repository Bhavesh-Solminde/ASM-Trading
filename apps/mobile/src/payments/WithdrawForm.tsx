import { router } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { applyKey, currencySymbol } from "@asm/client-core";
import { PAYOUT_METHODS, USDT_NETWORKS, USDT_NETWORK_INFO, withdrawalLimitsMinor, type PayoutMethod, type UsdtNetwork, type WithdrawalPrefill } from "@asm/contracts";
import { api } from "@/api/client";
import { invalidateMoney, queryClient, refetchWalletSettled } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { money, groupTyped } from "@/money/format";
import { amountInWords } from "@/money/words";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { AmountFigure } from "@/ui/AmountFigure";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/form";
import { Icon } from "@/ui/Icon";
import { KeyValueBox } from "@/ui/KeyValueBox";
import { Money } from "@/ui/Money";
import type { SheetRef } from "@/ui/Sheet";
import { toast } from "@/ui/Toast";
import { AmountSheet } from "./AmountSheet";
import {
  accountConfirmValue,
  amountTextFromMinor,
  canCancelHeld,
  initialPayout,
  isFromLastWithdrawal,
  payoutDestinationLabel,
  withdrawAmountOpts,
  withdrawBody,
  withdrawModel,
  type PayoutDraft,
} from "./withdraw-form";
import { refetchPrefill, useCancelWithdrawal } from "./useCancelWithdrawal";
import { WITHDRAW_TIMEOUT_MS, createWithdrawSubmitter } from "./withdraw-submit";

/**
 * Settles when the wallet and prefill refetches have landed or failed (an in-flight refetch is joined, not restarted).
 * A timed-out withdrawal keeps its button busy until then, so a second tap cannot create a second one first.
 */
const reconcileWithdrawal = () =>
  Promise.allSettled([
    refetchWalletSettled(),
    queryClient.invalidateQueries({ queryKey: ["withdrawal-prefill"] }, { cancelRefetch: false }),
  ]);

/** A group heading above chips: the same 14/500 `ink3` line as "Pay with" on Add money. */
function Heading({ children }: { children: string }) {
  return (
    <Txt size={14} weight={500} color={color.ink3} accessibilityRole="header">
      {children}
    </Txt>
  );
}

/** A field and the problem line under it, kept together so the column's gap does not push the message away. */
function Block({ children }: { children: ReactNode }) {
  return <View style={{ gap: 6 }}>{children}</View>;
}

/** One problem line under a field or the amount: `downText`, announced politely when it appears. */
function Problem({ children, testID }: { children: string; testID: string }) {
  return (
    <Txt testID={testID} size={13} color={color.downText} accessibilityLiveRegion="polite">
      {children}
    </Txt>
  );
}

/**
 * Everything under the header once the LIVE account, its withdrawable balance and the prefill have loaded: the held
 * withdrawals, then the KYC gate or the form. One screen, no confirm step (the amount is on the button).
 * `POST /api/withdrawals` is a money-moving call: 15s timeout, one tap at a time, never retried. Withdrawals always
 * come out of the LIVE account.
 */
export function WithdrawContent({ live, prefill, withdrawable }: { live: { id: string; currency: string }; prefill: WithdrawalPrefill; withdrawable: number }) {
  const { t, i18n } = useTranslation();
  const currency = live.currency;
  const [amount, setAmount] = useState("");
  const [pickedMethod, setPickedMethod] = useState<PayoutMethod | null>(null);
  // Only what the user changed is kept; every other field is derived from the prefill, which may arrive or refresh.
  const [edits, setEdits] = useState<Partial<Record<PayoutMethod, PayoutDraft>>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  // null until the user types in "Confirm account number"; until then it shows the saved bank account number.
  const [accountTyped, setAccountTyped] = useState<string | null>(null);
  const amountSheet = useRef<SheetRef>(null);

  const heldRows = prefill.heldWithdrawals;
  const { cancellingId, confirmCancel } = useCancelWithdrawal(currency, heldRows);

  // The submitter is built once (its in-flight flag must survive re-renders); it reads the latest `t` from here.
  const latest = useRef({ t });
  latest.current = { t };
  const submitter = useRef<ReturnType<typeof createWithdrawSubmitter> | null>(null);
  if (submitter.current === null) {
    submitter.current = createWithdrawSubmitter({
      post: (body) => api("/api/withdrawals", { method: "POST", body, timeoutMs: WITHDRAW_TIMEOUT_MS }),
      invalidateMoney,
      invalidatePrefill: refetchPrefill,
      awaitReconcile: reconcileWithdrawal,
      navigate: (id) => {
        // Back to where the user came from, then on to the new withdrawal in History (its detail sheet opens on `tx`).
        if (router.canGoBack()) router.back();
        else router.replace("/payments");
        router.navigate({ pathname: "/history", params: { tx: `w:${id}` } });
      },
      toast,
      session: () => useSession.getState().token,
      setBusy,
      t: (key, options) => latest.current.t(key, options),
    });
  }
  const method: PayoutMethod = pickedMethod ?? prefill.initialMethod ?? "UPI";
  const draft = edits[method] ?? initialPayout(prefill, method);
  const accountConfirm = accountConfirmValue(prefill, accountTyped);
  const model = withdrawModel({ amountText: amount, currency, withdrawable, payout: draft, accountConfirm });
  const limits = withdrawalLimitsMinor(currency);
  const locale = i18n.language.startsWith("hi") ? "hi" : "en";

  const edit = (change: (d: PayoutDraft) => PayoutDraft) =>
    setEdits((current) => ({ ...current, [method]: change(current[method] ?? initialPayout(prefill, method)) }));
  const touch = (field: string) => setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  const fieldProblem = (field: string, testID: string) => {
    const key = !model.payout.ok && touched[field] ? model.payout.fieldKeys[field] : undefined;
    return key ? <Problem testID={testID}>{t(key)}</Problem> : null;
  };

  const figure = `${currencySymbol(currency)} ${groupTyped(amount, currency)}`;
  const words =
    model.amountMinor === 0 ? t("withdraw.tapToEnter") : currency === "INR" ? amountInWords(model.amountMinor / 100, locale) : undefined;
  const problemText = model.problem
    ? t(`withdraw.${model.problem}`, { amount: money(model.problem === "min" ? limits.min : limits.max, currency, { trim: true }) })
    : null;

  const submit = () => {
    if (busy || !model.canSubmit || !model.payout.ok) return;
    let body;
    try {
      body = withdrawBody(live.id, model.amountMinor, model.payout.payout);
    } catch {
      toast(t("common.genericError"), "down");
      return;
    }
    void submitter.current?.(body);
  };

  // Cancel is offered only while the server would accept it (the row's `cancelableUntil`); after that the box just says so.
  const held = heldRows.map((w) => {
    const cancelable = canCancelHeld(w, Date.now());
    return (
      <View key={w.id} testID={`withdraw-held-${w.id}`} style={{ backgroundColor: color.surface, borderRadius: 14, padding: 16, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Txt size={16} weight={600} style={{ flex: 1 }}>
            {t("withdraw.heldTitle", { amount: money(w.amountMinor, currency, { trim: true }) })}
          </Txt>
          {cancelable ? (
            <Pressable
              testID={`withdraw-cancel-${w.id}`}
              accessibilityRole="button"
              accessibilityLabel={t("withdraw.cancel")}
              accessibilityState={{ disabled: cancellingId !== null, busy: cancellingId === w.id }}
              disabled={cancellingId !== null}
              onPress={() => confirmCancel(w.id, w.amountMinor)}
              style={{ minHeight: 44, minWidth: 44, flexShrink: 0, justifyContent: "center", alignItems: "flex-end", opacity: cancellingId !== null ? 0.5 : 1 }}
            >
              <Txt size={14} weight={600} color={color.downText}>
                {t("withdraw.cancel")}
              </Txt>
            </Pressable>
          ) : null}
        </View>
        <Txt testID={`withdraw-held-note-${w.id}`} size={13} color={color.ink2}>
          {t(cancelable ? "withdraw.heldBody" : "withdraw.heldBodyLocked")}
        </Txt>
      </View>
    );
  });

  if (prefill.kycStatus !== "VERIFIED") {
    const status = prefill.kycStatus;
    return (
      <>
        {held}
        <View testID="withdraw-gate" style={{ backgroundColor: color.surface, borderRadius: 14, padding: 16, gap: 8 }}>
          <Txt size={18} weight={600} accessibilityRole="header">
            {t(status === "PENDING" ? "withdraw.pendingTitle" : status === "REJECTED" ? "withdraw.rejectedTitle" : "withdraw.verifyTitle")}
          </Txt>
          <Txt size={14} color={color.ink2}>
            {t(status === "PENDING" ? "withdraw.pendingBody" : status === "REJECTED" ? "withdraw.rejectedBody" : "withdraw.verifyBody")}
          </Txt>
          {status === "PENDING" ? null : (
            <View style={{ paddingTop: 8 }}>
              <Button testID="withdraw-verify" kind="light" label={t("withdraw.verifyCta")} onPress={() => router.push("/account/verify")} />
            </View>
          )}
        </View>
      </>
    );
  }

  const network: UsdtNetwork = draft.method === "USDT" ? draft.usdtNetwork : "tron";
  return (
    <>
      {held}

      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Txt size={14} color={color.ink3} style={{ flex: 1 }}>
            {t("withdraw.amount")}
          </Txt>
          {model.maxMinor > 0 && !model.belowMinimum ? (
            <Pressable
              testID="withdraw-max"
              accessibilityRole="button"
              onPress={() => setAmount(amountTextFromMinor(model.maxMinor, currency))}
              style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}
            >
              <Txt size={14} weight={500} color={color.accentText}>
                {t("withdraw.maxButton", { amount: money(model.maxMinor, currency, { trim: true }) })}
              </Txt>
            </Pressable>
          ) : null}
        </View>
        <AmountFigure testID="withdraw-amount" text={figure} words={words} onPress={() => amountSheet.current?.present()} />
        <Txt size={13} color={color.ink3}>
          {t("withdraw.limits", { min: money(limits.min, currency, { trim: true }), max: money(limits.max, currency, { trim: true }) })}
        </Txt>
        {problemText ? <Problem testID="withdraw-problem">{problemText}</Problem> : null}
        {model.belowMinimum ? (
          <Txt testID="withdraw-not-enough" size={13} color={color.ink2}>
            {t("withdraw.notEnough", { amount: money(limits.min, currency, { trim: true }) })}
          </Txt>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Heading>{t("withdraw.sendTo")}</Heading>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("withdraw.sendTo")} style={{ flexDirection: "row", gap: 8 }}>
          {PAYOUT_METHODS.map((m) => (
            <Chip
              key={m}
              testID={`withdraw-method-${m}`}
              role="radio"
              label={t(`withdraw.method.${m}`)}
              selected={method === m}
              onPress={() => setPickedMethod(m)}
              disabled={busy}
              style={{ flex: 1, paddingHorizontal: 4 }}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: 14 }}>
        {draft.method === "UPI" ? (
          <Block>
            <Field
              testID="withdraw-upi"
              label={t("withdraw.upi")}
              value={draft.upiId}
              onChangeText={(text) => edit((d) => (d.method === "UPI" ? { ...d, upiId: text.replace(/\s+/g, "") } : d))}
              onBlur={() => touch("upiId")}
              placeholder={t("withdraw.upiPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              keyboardType="email-address"
              editable={!busy}
              trailing={model.payout.ok ? <Icon name="badgeCheck" size={22} color={color.up} /> : null}
            />
            {fieldProblem("upiId", "withdraw-error-upi")}
          </Block>
        ) : null}

        {draft.method === "BANK" ? (
          <>
            <Block>
              <Field
                testID="withdraw-holder"
                label={t("withdraw.holder")}
                value={draft.accountHolder}
                onChangeText={(text) => edit((d) => (d.method === "BANK" ? { ...d, accountHolder: text } : d))}
                onBlur={() => touch("accountHolder")}
                placeholder={t("withdraw.holderPlaceholder")}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={80}
                editable={!busy}
              />
              {fieldProblem("accountHolder", "withdraw-error-holder")}
            </Block>
            <Block>
              <Field
                testID="withdraw-account"
                label={t("withdraw.account")}
                value={draft.accountNumber}
                onChangeText={(text) => edit((d) => (d.method === "BANK" ? { ...d, accountNumber: text.replace(/\D/g, "").slice(0, 18) } : d))}
                onBlur={() => touch("accountNumber")}
                keyboardType="number-pad"
                inputMode="numeric"
                autoComplete="off"
                maxLength={18}
                editable={!busy}
              />
              {fieldProblem("accountNumber", "withdraw-error-account")}
            </Block>
            <Block>
              <Field
                testID="withdraw-account-confirm"
                label={t("withdraw.accountConfirm")}
                value={accountConfirm}
                onChangeText={(text) => setAccountTyped(text.replace(/\D/g, "").slice(0, 18))}
                onBlur={() => touch("accountConfirm")}
                placeholder={t("withdraw.accountConfirmPlaceholder")}
                keyboardType="number-pad"
                inputMode="numeric"
                autoComplete="off"
                maxLength={18}
                editable={!busy}
              />
              {model.accountConfirmKey && (touched.accountConfirm || (touched.accountNumber && accountConfirm !== "")) ? <Problem testID="withdraw-error-account-confirm">{t(model.accountConfirmKey)}</Problem> : null}
            </Block>
            <Block>
              <Field
                testID="withdraw-ifsc"
                label={t("withdraw.ifsc")}
                value={draft.ifsc}
                onChangeText={(text) => edit((d) => (d.method === "BANK" ? { ...d, ifsc: text.replace(/\s+/g, "").toUpperCase().slice(0, 11) } : d))}
                onBlur={() => touch("ifsc")}
                placeholder={t("withdraw.ifscPlaceholder")}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                maxLength={11}
                editable={!busy}
              />
              {fieldProblem("ifsc", "withdraw-error-ifsc")}
            </Block>
          </>
        ) : null}

        {draft.method === "USDT" ? (
          <>
            <View style={{ gap: 8 }}>
              <Heading>{t("withdraw.network")}</Heading>
              <View accessibilityRole="radiogroup" accessibilityLabel={t("withdraw.network")} style={{ flexDirection: "row", gap: 8 }}>
                {USDT_NETWORKS.map((n) => (
                  <Chip
                    key={n}
                    testID={`withdraw-network-${n}`}
                    role="radio"
                    label={USDT_NETWORK_INFO[n].standard}
                    selected={network === n}
                    onPress={() => edit((d) => (d.method === "USDT" ? { ...d, usdtNetwork: n } : d))}
                    disabled={busy}
                    style={{ flex: 1, paddingHorizontal: 4 }}
                  />
                ))}
              </View>
            </View>
            <Block>
              <Field
                testID="withdraw-address"
                label={t("withdraw.address", { network: USDT_NETWORK_INFO[network].standard })}
                value={draft.usdtAddress}
                onChangeText={(text) => edit((d) => (d.method === "USDT" ? { ...d, usdtAddress: text.replace(/\s+/g, "").slice(0, 64) } : d))}
                onBlur={() => touch("usdtAddress")}
                placeholder={network === "tron" ? "T…" : "0x…"}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                editable={!busy}
              />
              {fieldProblem("usdtAddress", "withdraw-error-address")}
            </Block>
          </>
        ) : null}

        {isFromLastWithdrawal(prefill, draft) ? (
          <Txt testID="withdraw-saved-hint" size={13} color={color.ink3}>
            {t("withdraw.savedHint")}
          </Txt>
        ) : null}
      </View>

      <KeyValueBox
        rows={[
          { key: "receive", label: t("withdraw.youReceive"), value: <Money text={money(model.amountMinor, currency)} size={14} weight={600} /> },
          { key: "to", label: t("withdraw.to"), testID: "withdraw-to", value: model.payout.ok ? payoutDestinationLabel(model.payout.payout) : "\u2014" },
          { key: "arrives", label: t("withdraw.arrives"), value: t("withdraw.eta") },
        ]}
      />

      {/* FormScroll pads the bottom inset (or the keyboard), so the button never sits under the navigation bar. */}
      <View style={{ paddingBottom: 8 }}>
        <Button
          testID="withdraw-submit"
          kind="light"
          label={model.amountMinor > 0 ? t("withdraw.submit", { amount: money(model.amountMinor, currency, { trim: true }) }) : t("withdraw.enterAmount")}
          disabled={!model.canSubmit}
          busy={busy}
          onPress={submit}
        />
      </View>

      <AmountSheet
        ref={amountSheet}
        title={t("withdraw.amount")}
        currency={currency}
        value={amount}
        quick={[]}
        onKey={(key) => setAmount((current) => applyKey(current, key, withdrawAmountOpts(currency)))}
        onPreset={setAmount}
      />
    </>
  );
}
