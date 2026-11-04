import { useNavigationContainerRef } from "expo-router";
import { useSyncExternalStore } from "react";

/** True once the root navigator can accept `router.replace`; navigating earlier throws or is dropped. */
export function useNavReady(): boolean {
  const ref = useNavigationContainerRef();
  return useSyncExternalStore(
    (onChange) => ref.addListener("state", onChange),
    () => ref.isReady(),
    () => false,
  );
}
