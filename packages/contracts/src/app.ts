import { z } from "zod";
import { USDT_NETWORKS } from "./deposit";
import { PAYOUT_METHODS } from "./withdrawal";

/**
 * Response shapes for the native app's /api/v1 reads. The server parses its
 * own output with these before sending; the app parses on receipt.
 */

const SEMVER = /^\d+\.\d+\.\d+$/;
const minor = z.number().int();
export const KycStatusSchema = z.enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"]);

export const LocaleSchema = z.enum(["en", "hi"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const ApiErrorSchema = z.object({ error: z.string(), code: z.string().optional() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const AppAssetSchema = z.object({
  symbol: z.string(),
  displayName: z.string(),
  precision: z.number().int(),
  payoutPct: z.number(),
  assetClass: z.string(),
});

export const AppAccountSchema = z.object({
  id: z.uuid(),
  type: z.enum(["LIVE", "DEMO"]),
  currency: z.string(),
  realBalance: minor,
  bonusBalance: minor,
});

export const ProfileSummarySchema = z.object({
  nickname: z.string().nullable(),
  email: z.string(),
  kycStatus: KycStatusSchema,
  locale: LocaleSchema,
});

/** Trades use the existing TradeView shape; kept loose here (validated by the engine contract). */
export const BootstrapSchema = z.object({
  userId: z.string(),
  assets: z.array(AppAssetSchema),
  accounts: z.array(AppAccountSchema),
  recentTrades: z.array(z.record(z.string(), z.unknown())),
  defaultSymbol: z.string(),
  liveAccess: z.boolean(),
  completedDeposits: z.number().int(),
  profile: ProfileSummarySchema,
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;

export const WalletSchema = z.object({
  accounts: z.array(AppAccountSchema),
  withdrawable: minor,
  lockedBonus: minor,
  completedDeposits: z.number().int(),
  nextBonusPercent: z.number(),
  bonusTiers: z.array(z.number()),
});
export type Wallet = z.infer<typeof WalletSchema>;

/** Mirrors PaymentRow in apps/web/src/components/history/history-model.ts. */
export const PaymentRowSchema = z.object({
  key: z.string(),
  id: z.string(),
  kind: z.enum(["deposit", "withdrawal"]),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  status: z.string(),
  methodLabel: z.string(),
  amountMinor: minor,
  currency: z.string(),
  destination: z.string().nullable(),
  expiresAt: z.string().nullable(),
  holdUntil: z.string().nullable(),
  cancelableUntil: z.string().nullable(),
});
export type PaymentRowDto = z.infer<typeof PaymentRowSchema>;

export const PaymentsPageSchema = z.object({
  rows: z.array(PaymentRowSchema),
  nextCursor: z.string().nullable(),
});
export type PaymentsPage = z.infer<typeof PaymentsPageSchema>;

export const DepositConfigSchema = z.object({
  upiEnabled: z.boolean(),
  usdtNetworks: z.array(z.enum(USDT_NETWORKS)),
  gatewayNetworks: z.array(z.enum(USDT_NETWORKS)),
  completedDeposits: z.number().int(),
  bonusTiers: z.array(z.number()),
});
export type DepositConfig = z.infer<typeof DepositConfigSchema>;

export const CheckoutViewSchema = z.object({
  id: z.string(),
  method: z.string(),
  status: z.enum(["AWAITING_PAYMENT", "PENDING_CONFIRMATION", "COMPLETED", "REJECTED", "EXPIRED"]),
  amountInr: minor,
  amountUsdtMinor: minor.nullable(),
  network: z.string().nullable(),
  expiresAt: z.string(),
  upiUri: z.string().nullable(),
  vpa: z.string().nullable(),
  receivingAddress: z.string().nullable(),
  isGateway: z.boolean(),
  isSlot: z.boolean(),
  claimedUtr: z.string().nullable(),
  claimedTxHash: z.string().nullable(),
  manualClaimDelaySec: z.number().int(),
});
export type CheckoutView = z.infer<typeof CheckoutViewSchema>;

export const WithdrawalPrefillSchema = z.object({
  lastPayouts: z.object({
    BANK: z.object({ accountHolder: z.string(), accountNumber: z.string(), ifsc: z.string() }).optional(),
    UPI: z.object({ upiId: z.string() }).optional(),
    USDT: z.object({ usdtNetwork: z.enum(USDT_NETWORKS), usdtAddress: z.string() }).optional(),
  }),
  initialMethod: z.enum(PAYOUT_METHODS).nullable(),
  kycName: z.string(),
  kycStatus: KycStatusSchema,
  heldWithdrawals: z.array(z.object({ id: z.string(), amountMinor: minor, createdAt: z.string() })),
});
export type WithdrawalPrefill = z.infer<typeof WithdrawalPrefillSchema>;

export const AppConfigSchema = z.object({
  minVersion: z.string().regex(SEMVER),
  latestVersion: z.string().regex(SEMVER),
  apkUrl: z.string(),
  playUrl: z.string().nullable(),
  playLive: z.boolean(),
  support: z.object({ whatsapp: z.string().nullable(), telegram: z.string().nullable() }),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const PreferencesUpdateSchema = z.strictObject({ locale: LocaleSchema.optional() });
export type PreferencesUpdate = z.infer<typeof PreferencesUpdateSchema>;

export const PreferencesSchema = z.object({ locale: LocaleSchema });
export type Preferences = z.infer<typeof PreferencesSchema>;
