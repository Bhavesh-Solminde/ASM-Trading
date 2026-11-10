import { create } from "zustand";
import type { GateState } from "@/api/errors";

export const useGate = create<{ gate: GateState; setGate: (g: GateState) => void }>((set) => ({
  gate: "ok",
  setGate: (gate) => set({ gate }),
}));
