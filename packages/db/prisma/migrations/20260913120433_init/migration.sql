-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('LIVE', 'DEMO');

-- CreateEnum
CREATE TYPE "LifecycleStage" AS ENUM ('PRE_DEPOSIT', 'DEPOSITED', 'HIGH_VALUE');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('REAL', 'OTC');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION', 'COMPLETED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "TxKind" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRADE_STAKE', 'TRADE_PAYOUT', 'TRADE_REFUND', 'BONUS_GRANT', 'BONUS_CONVERT', 'DEMO_RESET');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "twoFaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFaForLogin" BOOLEAN NOT NULL DEFAULT false,
    "twoFaForWithdrawal" BOOLEAN NOT NULL DEFAULT false,
    "nickname" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "aadhaar" TEXT,
    "address" TEXT,
    "country" TEXT,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "cumulativeDeposits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "realBalance" INTEGER NOT NULL DEFAULT 0,
    "bonusBalance" INTEGER NOT NULL DEFAULT 0,
    "turnoverProgress" INTEGER NOT NULL DEFAULT 0,
    "lifecycleStage" "LifecycleStage" NOT NULL DEFAULT 'PRE_DEPOSIT',
    "rollingWinRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tradesCount" INTEGER NOT NULL DEFAULT 0,
    "medianStake" INTEGER NOT NULL DEFAULT 100,
    "lossStreak" INTEGER NOT NULL DEFAULT 0,
    "winStreak" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "payoutPct" INTEGER NOT NULL DEFAULT 100,
    "payoutMin" INTEGER NOT NULL DEFAULT 100,
    "payoutMax" INTEGER NOT NULL DEFAULT 100,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "tickSize" DOUBLE PRECISION NOT NULL DEFAULT 0.00001,
    "precision" INTEGER NOT NULL DEFAULT 5,
    "basePrice" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "garchOmega" DOUBLE PRECISION NOT NULL DEFAULT 0.000001,
    "garchAlpha" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "garchBeta" DOUBLE PRECISION NOT NULL DEFAULT 0.90,
    "anchorAlpha" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candle" (
    "assetId" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "openTs" TIMESTAMP(3) NOT NULL,
    "o" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "l" DOUBLE PRECISION NOT NULL,
    "c" DOUBLE PRECISION NOT NULL,
    "shadowO" DOUBLE PRECISION,
    "shadowH" DOUBLE PRECISION,
    "shadowL" DOUBLE PRECISION,
    "shadowC" DOUBLE PRECISION,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("assetId","timeframe","openTs")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "stake" INTEGER NOT NULL,
    "payoutPct" INTEGER NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "entryTs" TIMESTAMP(3) NOT NULL,
    "expiryTs" TIMESTAMP(3) NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "status" "TradeStatus" NOT NULL DEFAULT 'OPEN',
    "pnl" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeShadow" (
    "tradeId" TEXT NOT NULL,
    "shownExitPrice" DOUBLE PRECISION NOT NULL,
    "honestExitPrice" DOUBLE PRECISION NOT NULL,
    "shownResult" TEXT NOT NULL,
    "honestResult" TEXT NOT NULL,
    "deltaPips" DOUBLE PRECISION NOT NULL,
    "biasApplied" DOUBLE PRECISION NOT NULL,
    "magnetApplied" DOUBLE PRECISION NOT NULL,
    "imbalanceAtEntry" DOUBLE PRECISION NOT NULL,
    "exposureUp" INTEGER NOT NULL,
    "exposureDown" INTEGER NOT NULL,
    "lifecycleStage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeShadow_pkey" PRIMARY KEY ("tradeId")
);

-- CreateTable
CREATE TABLE "ShadowTick" (
    "id" BIGSERIAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "shownPrice" DOUBLE PRECISION NOT NULL,
    "honestPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ShadowTick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountUsd" INTEGER NOT NULL,
    "amountInr" INTEGER NOT NULL,
    "vpa" TEXT NOT NULL,
    "checkoutToken" TEXT NOT NULL,
    "claimedUtr" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "matchedCreditId" TEXT,
    "correlationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankCredit" (
    "id" TEXT NOT NULL,
    "vpa" TEXT NOT NULL,
    "amountInr" INTEGER NOT NULL,
    "utr" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "raw" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "reviewedBy" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "TxKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusGrant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "turnoverRequired" INTEGER NOT NULL,
    "turnoverDone" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_userId_type_key" ON "Account"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");

-- CreateIndex
CREATE INDEX "Candle_assetId_timeframe_openTs_idx" ON "Candle"("assetId", "timeframe", "openTs");

-- CreateIndex
CREATE INDEX "Trade_accountId_createdAt_idx" ON "Trade"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_expiryTs_status_idx" ON "Trade"("expiryTs", "status");

-- CreateIndex
CREATE INDEX "ShadowTick_assetId_ts_idx" ON "ShadowTick"("assetId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_checkoutToken_key" ON "Deposit"("checkoutToken");

-- CreateIndex
CREATE INDEX "Deposit_vpa_amountInr_status_idx" ON "Deposit"("vpa", "amountInr", "status");

-- CreateIndex
CREATE INDEX "Deposit_userId_createdAt_idx" ON "Deposit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Deposit_status_idx" ON "Deposit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BankCredit_utr_key" ON "BankCredit"("utr");

-- CreateIndex
CREATE INDEX "BankCredit_vpa_amountInr_consumed_idx" ON "BankCredit"("vpa", "amountInr", "consumed");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_createdAt_idx" ON "Withdrawal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_accountId_createdAt_idx" ON "Transaction"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "BonusGrant_accountId_idx" ON "BonusGrant"("accountId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candle" ADD CONSTRAINT "Candle_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShadow" ADD CONSTRAINT "TradeShadow_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusGrant" ADD CONSTRAINT "BonusGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
