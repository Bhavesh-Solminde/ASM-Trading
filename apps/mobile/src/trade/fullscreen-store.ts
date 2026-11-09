import { create } from "zustand";
/** Presentation only: changing this never changes the chart key or subscription. */
export const useFullscreen = create<{ active: boolean; set: (active: boolean) => void }>((set) => ({
  active: false,
  set: (active) => set({ active }),
}));
