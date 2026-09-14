import type { LifecycleStage } from "./constants";

export interface WindowEntry {
  readonly weight: number;
  readonly won: boolean;
}

export interface AccountStats {
  readonly stage: LifecycleStage;
  /** Most recent settled trades, oldest first, at most WINDOW_SIZE entries. */
  readonly shortWindow: WindowEntry[];
  readonly lifetimeWonWeight: number;
  readonly lifetimeTotalWeight: number;
  readonly lossStreak: number;
  readonly winStreak: number;
  readonly medianStake: number;
}

export interface ControllerOutput {
  /** Win probability for the next trade on this account. */
  readonly p: number;
  readonly ceilingActive: boolean;
  /** How much the engine cares about honouring this outcome, in [0, 2]. */
  readonly urgency: number;
  /** Diagnostics for the shadow ledger and bridge logging. */
  readonly posteriorShort: number;
  readonly posteriorLife: number;
  readonly target: number;
  /** The stage used to compute this output. */
  readonly stage: LifecycleStage;
}
