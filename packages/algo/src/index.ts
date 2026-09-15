export * from "./constants";
export type { WindowEntry, AccountStats, ControllerOutput } from "./types";
export { tradeWeight, posterior, posteriorFromTotals } from "./estimator";
export { desiredWinProb, drawOutcome, stageFor } from "./controller";
export {
  imbalance,
  totalExposure,
  exposureScale,
  driftBias,
  expiryMagnet,
} from "./exposure";
export { resolveBucket, type BucketWish } from "./resolve";
