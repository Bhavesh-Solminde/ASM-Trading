import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { BackHandler, Text } from "react-native";
import { color, space } from "@/theme/tokens";

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
}

const body = { padding: space(4), paddingBottom: space(8), gap: space(3) } as const;

export const Sheet = forwardRef<SheetRef, SheetProps>(function Sheet({ title, children, snapPoints, scroll, onDismiss }, ref) {
  const inner = useRef<BottomSheetModal>(null);
  const [presented, setPresented] = useState(false);

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
    (p: BottomSheetBackdropProps) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} />,
    [],
  );

  const heading = title ? <Text style={{ color: color.ink, fontSize: 17, fontWeight: "700" }}>{title}</Text> : null;

  return (
    <BottomSheetModal
      ref={inner}
      snapPoints={snapPoints}
      enableDynamicSizing={!snapPoints}
      enablePanDownToClose
      onDismiss={handleDismiss}
      backgroundStyle={{ backgroundColor: color.panel }}
      handleIndicatorStyle={{ backgroundColor: color.ink2 }}
      backdropComponent={backdrop}
      {...(scroll ? { keyboardBehavior: "extend", keyboardBlurBehavior: "restore", android_keyboardInputMode: "adjustResize" } : {})}
    >
      {scroll ? (
        <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={body}>
          {heading}
          {children}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView style={body}>
          {heading}
          {children}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  );
});
