export { prisma } from "./client";
export { marketReferenceRepository } from "./repositories/market-reference";
export { reserveOtcTrade,finalizeOtcOpen,settleOtcTrade,OtcRejected,type OtcTradeRequest,type OtcOpenIntent } from "./repositories/otc-trade";
export { assertOtcFence,type OtcFence } from "./repositories/otc-fence";
export { toMinor, toMajor, formatMoney } from "./money";
export { LEADERBOARD_COUNTRIES, normalizeCountry, isLeaderboardCountry } from "./country";
export {
  listAccountsForActor,
  getAccountForActor,
  createAccountsForUser,
  changeAccountCurrency,
  convertAccountCurrency,
  convertMinorBetween,
  USD_INR_RATE,
  setDemoBalance,
  demoBalanceCap,
  CurrencyChangeRefused,
  DemoBalanceRefused,
  DEMO_START_BY_CURRENCY,
} from "./repositories/account";
export {
  findUserByEmail,
  findUserById,
  writeSignupCapture,
  updateUserLastSeen,
  setUserStatus,
  findOrCreateGoogleUser,
  GoogleAccountConflict,
  portalWhere,
  type Portal,
} from "./repositories/user";
export {
  normaliseReferralCode,
  ensureReferralCode,
  resolveInvitationCode,
  attachReferralAtSignup,
  getReferralSummaryForAdmin,
  type ReferralOutcome,
  type ReferralSummary,
} from "./repositories/referral";
export {
  evaluateReferralQualification,
  inviteExtraBonusPreviewPct,
  listUnqualifiedReferredUserIds,
  reverseQualificationForDeposit,
  realStakeInrMinor,
  type QualificationOutcome,
} from "./repositories/referral-qualification";
export {
  getProgramSettings,
  settingsAt,
  PROGRAM_SETTING_KEYS,
  type ProgramSettings,
} from "./repositories/program-settings";
export { getAffiliateRateAt, type AffiliateRateAt } from "./repositories/affiliate-rate";
// Affiliate program — affiliate status / admin (Affiliate Program spec).
export { ProgramActionRefused } from "./repositories/program-errors";
export {
  ensureAffiliateProfile,
  onAffiliateEmailVerified,
  programSettingValueAt,
} from "./repositories/affiliate-profile";
export {
  ADMIN_PAGE_SIZE,
  setAffiliateStatus,
  appendAffiliateRate,
  appendProgramSetting,
  listProgramSettingHistory,
  listAffiliatesForAdmin,
  getAffiliateAdminDetail,
  listEarningsForReview,
  releaseHeldEarning,
  voidHeldEarning,
  clearNeedsReview,
  type ProgramSettingVersion,
  type AffiliateAggregates,
  type AffiliateAdminRow,
  type AffiliateAdminDetail,
  type EarningForReview,
} from "./repositories/program-admin";
// Affiliate program — money core: wallet, transfers, withdrawals, Revenue Share, daily close.
export {
  getProgramSummary,
  listProgramActivity,
  createProgramAdjustment,
  countProgramWithdrawalsUsed,
  istLimitWindows,
  istDay,
  type ProgramRefusalCode,
  type ProgramSummary,
  type ProgramActivityItem,
} from "./repositories/program-wallet";
export { transferProgramEarningsToTrading, type ProgramTransferResult } from "./repositories/program-transfer";
export {
  requestProgramWithdrawal,
  cancelProgramWithdrawal,
  listProgramWithdrawals,
  listProgramWithdrawalsForAdmin,
  approveProgramWithdrawal,
  rejectProgramWithdrawal,
  markProgramWithdrawalPaid,
  PROGRAM_WITHDRAWALS_PAGE_SIZE,
} from "./repositories/program-withdrawal";
export { revenueShareOf } from "./repositories/revenue-share";
export { closeProgramDay, closeDueProgramDays, type ProgramDayCloseResult } from "./repositories/program-day-close";
export {
  detectLinkage,
  loadUserFacts,
  flagLinkageForUser,
  listOpenFraudFlags,
  reviewFraudFlag,
  type UserFacts,
  type LinkageEvidence,
  type LinkageVerdict,
  type Linkage,
} from "./repositories/fraud";
export {
  dailyLeaderboard,
  leaderboardCurrencyFor,
  type LeaderboardEntry,
  type LeaderboardResult,
} from "./repositories/leaderboard";
export {
  houseDateForInstant,
  getHouseDay,
  listHouseDays,
  upsertHouseDayTarget,
  applySettlementToHouseDay,
  recentLossStreakStatsForAccount,
} from "./repositories/house-day";
export {
  getTreasury,
  applySettlementToTreasury,
  setTreasuryTarget,
} from "./repositories/house-treasury";
export {
  AmountSpaceExhausted,
  DepositNotFound,
  DepositAlreadyResolved,
  DepositReversalRefused,
  UtrAlreadyClaimed,
  OFFSET_LOW,
  OFFSET_SPACE,
  DEPOSIT_TTL_MINUTES,
  MIN_DEPOSIT_USD_MINOR,
  MAX_DEPOSIT_USD_MINOR,
  MIN_DEPOSIT_INR_MINOR,
  MAX_DEPOSIT_INR_MINOR,
  DEMO_VPA,
  BONUS_TIERS,
  bonusPercentForDeposit,
  countCompletedDeposits,
  TURNOVER_MULTIPLE,
  USDT_OFFSET_LOW,
  USDT_OFFSET_SPACE,
  USDT_DEPOSIT_TTL_MINUTES,
  MIN_DEPOSIT_USDT_MINOR,
  MAX_DEPOSIT_USDT_MINOR,
  USDT_RESERVATION_QUARANTINE_MS,
  depositCreditMinor,
  creditedMinorByDeposit,
  expireStaleUsdtDeposits,
  createDepositIntent,
  createUsdtDepositIntent,
  createUsdtSlotDepositIntent,
  UsdtSlotBusy,
  USDT_SLOT_GAP_MS,
  findLiveDepositByAmount,
  findLiveDepositByClaimedUtr,
  creditDepositToAccount,
  getDepositByToken,
  getDepositForActor,
  listDepositsForActor,
  listPendingDeposits,
  rejectDeposit,
  reverseCompletedDeposit,
  reverseUsdtDepositAndRequeue,
  claimUtr,
  claimUsdtPayment,
} from "./repositories/deposit";
export { buildDepositReceipt, getDepositReceipt, type DepositReceipt, type ReceiptTx } from "./repositories/deposit-receipt";
export {
  matchCreditToDeposit,
  type MatchOutcome,
} from "./repositories/deposit-matcher";
export {
  WithdrawalRefused,
  WITHDRAWAL_HOLD_HOURS,
  WITHDRAWAL_CANCEL_WINDOW_HOURS,
  FIRST_WITHDRAWAL_WINDOW_HOURS,
  withdrawableBalance,
  requestWithdrawal,
  approveWithdrawal,
  cancelHeldWithdrawal,
  autoPromoteHeldWithdrawals,
  releaseHeldWithdrawal,
  rejectWithdrawal,
  markWithdrawalPaid,
  getWithdrawalNotice,
  listWithdrawalsForActor,
  getWithdrawalForActor,
  withdrawalLimitsMinor,
  type WithdrawalPayout,
} from "./repositories/withdrawal";
export {
  loadProfile,
  setLocale,
  updateProfile,
  saveKycDocument,
  submitKyc,
  listKycDocuments,
  loadKycDocumentImage,
  setTwoFactorPreferences,
  KycLocked,
  KycNotPending,
  reviewKyc,
  KYC_DOCUMENT_KINDS,
  type KycSubmitResult,
  type ProfileView,
} from "./repositories/profile";
export { issueTwoFactorCode, verifyTwoFactorCode } from "./repositories/twofa";
export {
  PASSWORD_RESET_TTL_MS,
  issuePasswordResetToken,
  resetPasswordWithToken,
} from "./repositories/password-reset";
export {
  EMAIL_VERIFICATION_TTL_MS,
  issueEmailVerificationToken,
  consumeEmailVerificationToken,
} from "./repositories/email-verification";
export { createTicket, listTicketsForActor } from "./repositories/support";
export {
  createRelayMessage,
  linkRelayMessageToCredit,
  listRelayMessages,
} from "./repositories/relay-message";
export {
  createBankCreditIfNew,
  findBankCreditByUtr,
  listOrphanBankCredits,
} from "./repositories/bank-credit";
export {
  createChainCreditIfNew,
  findChainCreditByKey,
  findChainCreditById,
  findChainCreditForDepositDisplay,
  listPendingFinalityChecks,
  listPendingMatches,
  listOrphanChainCredits,
  listManualReviewChainCredits,
  type ChainCreditScope,
} from "./repositories/chain-credit";
export {
  matchChainCreditToDeposit,
  findLiveDepositByUsdtAmount,
  type ChainMatchOutcome,
} from "./repositories/chain-credit-matcher";
export {
  GATEWAY_TATUM,
  GATEWAY_USDT_DEPOSIT_TTL_MINUTES,
  GATEWAY_EXPIRE_GRACE_MS,
  GATEWAY_WATCH_AFTER_EXPIRY_MS,
  allocateGatewayAddressIndex,
  createGatewayUsdtDeposit,
  setGatewaySubscriptionId,
  findGatewayDepositByAddress,
  listGatewayDepositsToWatch,
  listGatewayDepositsToExpire,
  expireGatewayDeposit,
  markChainCreditsFinalForTx,
  markChainCreditsFailedForTx,
  listDetectedGatewayCredits,
  listFinalUnmatchedGatewayCredits,
  findLatestChainCreditForGatewayDeposit,
  matchGatewayChainCredit,
  type GatewayMatchOutcome,
  type GatewayManualReviewReason,
} from "./repositories/gateway-deposit";
export {
  listGatewaySweepCandidates,
  startGatewaySweep,
  updateGatewaySweep,
  listOpenGatewaySweeps,
  type GatewaySweepCandidate,
} from "./repositories/gateway-sweep";
export {
  ChainCreditResolutionRefused,
  listUsdtReviewQueue,
  countUsdtReviewQueue,
  listCandidateDepositsForChainCredit,
  resolveChainCreditToDeposit,
  dismissChainCredit,
  getUsdtReviewEvidence,
  type UsdtClaimEvidence,
  type UsdtKnownSender,
  type UsdtReviewEvidence,
} from "./repositories/chain-credit-admin";
export {
  getOrCreateCursor,
  ensureSessionOpen,
  advanceSessionPage,
  closeSession,
  getOrCreateEvmCursor,
  advanceEvmCursor,
  type CursorKey,
} from "./repositories/chain-scan-cursor";
export { hasActiveUsdtWork } from "./repositories/usdt-activity";
export { rawPerMinor, rawToNormalizedMinor, normalizedMinorToRaw } from "./usdt-money";
export {
  InsufficientFunds,
  AccountNotActive,
  ConcurrentModification,
  AlreadySettled,
  TradeNotFound,
  openTrade,
  openTradeRecord,
  settleTrade,
  updateTradeStamp,
  voidTrade,
  listTradesForActor,
  loadOpenPositions,
  loadTradeShadow,
  type OpenTradeInput,
  type OpenedTrade,
  type SettledTrade,
  type ShadowInput,
} from "./repositories/trade";
export {
  loadAccountStats,
  recordSettledTrade,
} from "./repositories/account-stats";
export { provisionBots, resetDemoBalance } from "./repositories/bots";
export { setLifecycleOverride } from "./repositories/lifecycle";
export {
  STUCK_TRANSFER_AGE_MS,
  findReconciliationIssues,
  runUsdtReconciliation,
  listOpenReconciliationIssues,
  countOpenReconciliationIssues,
  listRecentlyResolvedReconciliationIssues,
  type ReconciliationSeverity,
  type ReconciliationFinding,
  type ReconciliationRunSummary,
} from "./repositories/reconciliation";
export * from "../generated/prisma/client";
// Number-typed money rows (see client.ts) — these names shadow the generated
// bigint-typed models re-exported above.
export type {
  User,
  Account,
  Trade,
  HouseDay,
  HouseTreasury,
  TradeShadow,
  Deposit,
  BankCredit,
  RelayMessage,
  ChainCredit,
  Withdrawal,
  Transaction,
  BonusGrant,
  ProgramSetting,
  ReferralQualification,
  ProgramEarning,
  ProgramWallet,
  ProgramLedgerEntry,
  ProgramTransfer,
  ProgramWithdrawal,
  RevenueShareDay,
} from "./models";
export type { DbClient, DbTransaction } from "./client";

export { demoLeaderboard } from "./repositories/demo-leaderboard";
export * from "./repositories/notifications";
export type { PushDevice, NotificationOutbox } from "../generated/prisma/client";

export { USD_TO_INR_RATE } from "./repositories/deposit";
