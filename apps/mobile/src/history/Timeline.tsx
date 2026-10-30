import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { timelineSteps, type StepState, type TimelineKind } from "@asm/client-core";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { dotState, timelineCopy } from "./timeline-copy";

const DOT = 14;

/** A 14pt dot: done = `up` fill, current = `accentText` ring, todo = `rule` ring, ended = `downText` fill. */
function Dot({ state }: { state: StepState }) {
  const filled = state === "done" || state === "ended";
  const tone = state === "done" ? color.up : state === "ended" ? color.downText : state === "current" ? color.accentText : color.rule;
  return <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, marginTop: 3, backgroundColor: filled ? tone : "transparent", borderWidth: filled ? 0 : 2, borderColor: tone }} />;
}

/**
 * The steps a deposit or withdrawal goes through, from client-core `timelineSteps(kind, status)`, as a vertical list on a
 * `surface` card. Each row is announced as one line ("Paid. Sent to your payout details. Done"): the dot's colour is never
 * the only signal. The connector under a step is `up` when the next step has been reached, `downText` into an ended step, `rule` otherwise. The server
 * keeps no per-step times, so none are shown here (Created / Confirmed are rows of the facts box above).
 */
export function Timeline({ kind, status }: { kind: TimelineKind; status: string }) {
  const { t } = useTranslation();
  const steps = timelineSteps(kind, status);
  return (
    <View testID="payment-timeline" style={{ backgroundColor: color.surface, borderRadius: 14, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
      {steps.map((step, i) => {
        const copy = timelineCopy(kind, step);
        const next = steps[i + 1];
        const last = next === undefined;
        const title = t(copy.titleKey);
        const detail = t(copy.detailKey);
        const ink = step.state === "todo" ? color.ink3 : step.state === "ended" ? color.downText : color.ink;
        return (
          <View key={step.id} testID={`timeline-${step.id}`} accessible accessibilityLabel={`${title}. ${detail}. ${t(`history.timeline.state.${step.state}`)}`} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ width: DOT, alignItems: "center" }}>
              <Dot state={dotState(step).dot} />
              {last ? null : <View style={{ flex: 1, width: 2, minHeight: 20, marginVertical: 4, borderRadius: 1, backgroundColor: next.state === "ended" ? color.downText : dotState(next).connectorAboveReached ? color.up : color.rule }} />}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 12 : 14 }}>
              <Txt size={15} weight={600} color={ink}>{title}</Txt>
              <Txt size={13} color={color.ink2}>{detail}</Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}
