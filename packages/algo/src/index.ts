export * from "./constants";
export type { WindowEntry, AccountStats, ControllerOutput } from "./types";
export { tradeWeight, posterior, posteriorFromTotals } from "./estimator";
export { stageFor, desiredWinProb, drawOutcome } from "./controller";
export {
  totalExposure,
  imbalance,
  exposureScale,
  driftBias,
} from "./exposure";
export { expiryMagnet, reachableMove, targetMargin } from "./magnet";
export { resolveBucket, type BucketWish } from "./resolve";
