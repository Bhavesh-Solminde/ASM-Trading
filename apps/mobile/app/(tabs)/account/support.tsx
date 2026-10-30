import { FAQ } from "@asm/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { shouldRefetchOnFocus } from "@/api/focus-refetch";
import { useAppConfig, useTickets } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { whenText } from "@/history/format";
import { NewTicketSheet } from "@/support/NewTicketSheet";
import { faqKeys, supportLinks, ticketBody, ticketErrorText, ticketSubmitEnabled, ticketTag, TICKET_TIMEOUT_MS } from "@/support/support-model";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { Icon } from "@/ui/Icon";
import { ListState } from "@/ui/ListState";
import type { SheetRef } from "@/ui/Sheet";
import { StatusTag } from "@/ui/StatusTag";
import { toast } from "@/ui/Toast";

const FAQ_KEYS = faqKeys(FAQ.length);

/**
 * Help & support (R2 "Support"): WhatsApp / Telegram when the server's app config has them, the FAQ as an accordion,
 * the user's tickets, and a New ticket sheet (POST /api/support, then the list refetches). The FAQ's English is the
 * contracts `FAQ` (the website's copy too); `support.faq.<n>` holds it in both languages.
 */
export default function Support() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const sessionLive = useSessionLive();
  const config = useAppConfig();
  const tickets = useTickets(sessionLive);
  const { refetch, dataUpdatedAt } = tickets;
  const updatedAt = useRef(dataUpdatedAt);
  updatedAt.current = dataUpdatedAt;
  useFocusEffect(
    useCallback(() => {
      if (shouldRefetchOnFocus({ live: sessionLive, dataUpdatedAt: updatedAt.current, now: Date.now() })) void refetch({ cancelRefetch: false });
    }, [sessionLive, refetch]),
  );

  const links = supportLinks(config.data?.support);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggleFaq = (i: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => toast(t("support.openFailed"), "down"));
  };

  // The draft lives here, not in the sheet: its content only exists while it is open.
  const sheet = useRef<SheetRef>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const send = async () => {
    if (inFlight.current) return;
    setTouched(true);
    if (!ticketSubmitEnabled(subject, body)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api("/api/support", { method: "POST", body: ticketBody(subject, body), timeoutMs: TICKET_TIMEOUT_MS });
      setSubject("");
      setBody("");
      setTouched(false);
      sheet.current?.dismiss();
      toast(t("support.sent"), "up");
      await refetch();
    } catch (e) {
      setError(ticketErrorText(e, t));
      // A timeout or a dropped connection may still have created the ticket: look before anyone sends it twice.
      if (e instanceof ApiError && (e.code === "timeout" || e.code === "offline")) void refetch();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const list = tickets.data ?? [];
  const now = Date.now();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 28, paddingBottom: 20 + insets.bottom }}>
        <BackHeader title={t("redesign.support")} />

        {links.length > 0 ? (
          <View style={{ gap: 12 }}>
            <View style={{ gap: 2 }}>
              <Txt accessibilityRole="header" size={18} weight={600}>
                {t("support.contactTitle")}
              </Txt>
              <Txt size={14} color={color.ink2}>
                {t("support.contactHint")}
              </Txt>
            </View>
            {links.map((link) => (
              <Button key={link.id} testID={`support-${link.id}`} kind="secondary" label={t(`support.${link.id}`)} onPress={() => openLink(link.url)} />
            ))}
          </View>
        ) : null}

        <View style={{ gap: 4 }}>
          <Txt accessibilityRole="header" size={18} weight={600} style={{ marginBottom: 4 }}>
            {t("support.faqTitle")}
          </Txt>
          <View style={{ backgroundColor: color.surface, borderRadius: 14, paddingHorizontal: 16 }}>
            {FAQ_KEYS.map((key, i) => {
              const expanded = open.has(i);
              return (
                <View key={key.q} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: color.rule }}>
                  <Pressable
                    testID={`support-faq-${i + 1}`}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={t(key.q)}
                    onPress={() => toggleFaq(i)}
                    style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, opacity: pressed ? 0.85 : 1 })}
                  >
                    <Txt size={15} weight={600} style={{ flex: 1 }}>
                      {t(key.q)}
                    </Txt>
                    <Icon name={expanded ? "chevronDown" : "chevron"} size={16} color={color.ink3} />
                  </Pressable>
                  {expanded ? (
                    <Txt testID={`support-faq-${i + 1}-answer`} size={14} color={color.ink2} style={{ paddingBottom: 16 }}>
                      {t(key.a)}
                    </Txt>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}>
            <Txt accessibilityRole="header" size={18} weight={600} style={{ flex: 1 }}>
              {t("support.ticketsTitle")}
            </Txt>
            <View style={{ flexShrink: 0 }}>
              <Button testID="support-new-ticket" kind="secondary" label={t("support.newTicket")} onPress={() => {
                setError(null);
                sheet.current?.present();
              }} />
            </View>
          </View>
          <ListState
            loading={tickets.isPending}
            error={tickets.isError && list.length === 0}
            {...(tickets.isSuccess && list.length === 0 ? { empty: t("support.ticketsEmpty") } : null)}
            onRetry={() => void refetch()}
            rows={2}
          />
          {list.length > 0 ? (
            <View style={{ backgroundColor: color.surface, borderRadius: 14, paddingHorizontal: 16 }}>
              {list.map((ticket, i) => {
                const tag = ticketTag(ticket.status);
                const when = whenText(t, Date.parse(ticket.createdAt), now);
                const status = t(tag.labelKey);
                return (
                  <View
                    key={ticket.id}
                    testID={`support-ticket-${ticket.id}`}
                    accessible
                    accessibilityLabel={`${ticket.subject}, ${status}, ${when}`}
                    style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: color.rule }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt size={15} weight={600} numberOfLines={2}>
                        {ticket.subject}
                      </Txt>
                      <Txt size={13} color={color.ink2} numberOfLines={1}>
                        {when}
                      </Txt>
                    </View>
                    <View style={{ flexShrink: 0 }}>
                      <StatusTag tone={tag.tone} label={status} />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>
      <NewTicketSheet ref={sheet} subject={subject} body={body} onSubject={setSubject} onBody={setBody} touched={touched} busy={busy} error={error} onSend={() => void send()} />
    </Screen>
  );
}
