import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ticketProblems, TICKET_BODY_MAX, TICKET_SUBJECT_MAX } from "@/support/support-model";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Field } from "@/ui/form";
import { Sheet, type SheetRef } from "@/ui/Sheet";

/**
 * The "New ticket" form in a sheet. Controlled: the draft lives in the screen (the sheet's content only exists while it
 * is open, and a swipe-down must not throw a half-written message away). Problems show once the user has tried to send
 * (`touched`), as client-side keys, never zod's English text.
 */
export const NewTicketSheet = forwardRef<
  SheetRef,
  {
    subject: string;
    body: string;
    onSubject: (v: string) => void;
    onBody: (v: string) => void;
    touched: boolean;
    busy: boolean;
    error: string | null;
    onSend: () => void;
  }
>(function NewTicketSheet({ subject, body, onSubject, onBody, touched, busy, error, onSend }, ref) {
  const { t } = useTranslation();
  const problems = touched ? ticketProblems(subject, body) : {};
  return (
    <Sheet ref={ref} title={t("support.sheetTitle")} snapPoints={["85%"]} scroll>
      <Field
        inSheet
        testID="support-subject"
        label={t("support.subject")}
        value={subject}
        onChangeText={onSubject}
        placeholder={t("support.subjectPlaceholder")}
        maxLength={TICKET_SUBJECT_MAX}
        returnKeyType="next"
        autoCapitalize="sentences"
      />
      {problems.subject ? (
        <Txt testID="support-subject-problem" size={13} color={color.downText} accessibilityLiveRegion="polite">
          {t(problems.subject)}
        </Txt>
      ) : null}
      <Field
        inSheet
        testID="support-body"
        label={t("support.message")}
        value={body}
        onChangeText={onBody}
        placeholder={t("support.messagePlaceholder")}
        maxLength={TICKET_BODY_MAX}
        multiline
        minHeight={140}
        autoCapitalize="sentences"
      />
      {problems.body ? (
        <Txt testID="support-body-problem" size={13} color={color.downText} accessibilityLiveRegion="polite">
          {t(problems.body)}
        </Txt>
      ) : null}
      {error ? (
        <Txt testID="support-send-error" size={14} color={color.downText} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      <View>
        <Button testID="support-send" kind="light" label={t("support.send")} busy={busy} onPress={onSend} />
      </View>
    </Sheet>
  );
});
