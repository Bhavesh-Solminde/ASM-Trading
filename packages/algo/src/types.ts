import type { LifecycleStage } from "./constants";

export interface WindowEntry {
  readonly weight: number;
  readonly won: boolean;
}

export interface AccountStats {
  readonly stage: LifecycleStage;
  readonly shortWindow: WindowEntry[];
  readonly lifetimeWonWeight: number;
  readonly lifetimeTotalWeight: number;
  readonly lossStreak: number;
  readonly winStreak: number;
  readonly medianStake: number;
}

export interface ControllerOutput {
  readonly p: number;
  readonly ceilingActive: boolean;
  readonly urgency: number;
  readonly posteriorShort: number;
  readonly posteriorLife: number;
  readonly target: number;
}
