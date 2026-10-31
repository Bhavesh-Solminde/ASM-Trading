import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { BackHandler, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

export interface SheetRef {
  present: () => void;
  dismiss: () => void;
}

interface SheetProps {
  title?: string;
  children: ReactNode;
  snapPoints?: (string | number)[];
  /**
   * Long content (a searchable list): needs `snapPoints`, scrolls inside the sheet, keeps taps working while
   * the keyboard is up, and resizes with the keyboard so a search field stays visible.
   */
  scroll?: boolean;
  onDismiss?: () => void;
  /** Small text right of the title (e.g. "Demo account"). */
  aside?: string;
  /** Content spans the full width and pads itself; the title keeps 20pt sides. */
  flush?: boolean;
}

const body = { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 28, gap: 12 } as const;
const bodyFlush = { paddingTop: 4, paddingBottom: 0 } as const;

export const Sheet = forwardRef<SheetRef, SheetProps>(function Sheet({ title, children, snapPoints, scroll, onDismiss, aside, flush }, ref) {
  const inner = useRef<BottomSheetModal>(null);
  const [presented, setPresented] = useState(false);
  // Edge-to-edge (SDK 36): every sheet's last row clears the system navigation bar (3-button nav is ~48dp).
  const bottomInset = useSafeAreaInsets().bottom;
  const pad = flush ? bodyFlush : body;
  const bodyStyle = [pad, { paddingBottom: pad.paddingBottom + bottomInset }];

  useImperativeHandle(ref, () => ({
    present: () => {
      setPresented(true);
      inner.current?.present();
    },
    dismiss: () => inner.current?.dismiss(),
  }));

  // @gorhom modals ignore the Android back button, so close on it while presented. Registered only then
  // (RN calls the newest listener first, so the topmost sheet wins) and removed on dismiss/unmount.
  useEffect(() => {
    if (!presented) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (inner.current === null) return false;
      inner.current.dismiss();
      return true;
    });
    return () => sub.remove();
  }, [presented]);

  const handleDismiss = useCallback(() => {
    setPresented(false);
    onDismiss?.();
  }, [onDismiss]);

  const backdrop = useCallback(
    (p: BottomSheetBackdropProps) => <BottomSheetBackdrop {...p} opacity={0.62} appearsOnIndex={0} disappearsOnIndex={-1} />,
    [],
  );

  // Title and aside share the row with `flex: 1` each, never as shrink-wrapped text: a multi-word Hindi title
  // that is sized to its own measured width can draw a hair wider than it measured, wrap, and lose its last
  // words below the row. A definite width wraps cleanly and the row grows with it.
  const heading = title ? (
    <View style={[{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 }, flush ? { paddingHorizontal: 20, paddingBottom: 12 } : null]}>
      <Txt weight={600} size={20} accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </Txt>
      {aside ? (
        <Txt size={14} color={color.ink3} style={{ flex: 1, textAlign: "right" }}>
          {aside}
        </Txt>
      ) : null}
    </View>
  ) : null;

  return (
    <BottomSheetModal
      ref={inner}
      snapPoints={snapPoints}
      enableDynamicSizing={!snapPoints}
      enablePanDownToClose
      onDismiss={handleDismiss}
      backgroundStyle={{
        backgroundColor: color.surface,
        borderTopLeftRadius: radius.sheet,
        borderTopRightRadius: radius.sheet,
        borderTopWidth: 1,
        borderColor: color.rule,
      }}
      handleStyle={{ paddingTop: 10, paddingBottom: 6 }}
      handleIndicatorStyle={{ backgroundColor: color.rule, width: 40, height: 5, borderRadius: 4 }}
      backdropComponent={backdrop}
      {...(scroll ? { keyboardBehavior: "extend", keyboardBlurBehavior: "restore", android_keyboardInputMode: "adjustResize" } : {})}
    >
      {scroll ? (
        <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={bodyStyle}>
          {heading}
          {presented ? children : null}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView style={bodyStyle}>
          {heading}
          {presented ? children : null}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  );
});
