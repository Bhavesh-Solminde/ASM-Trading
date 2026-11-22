import { USD_INR_RATE } from "@asm/contracts";
import { Prisma } from "../../generated/prisma/client";

/** The incoming query provides referrals(userId). Keep reversed credits in the
 * ranking so that a second credit cannot become a trader's first deposit. */
export const affiliateDepositCtes = Prisma.sql`
  live_deposits AS (
    SELECT d.id, d."userId", d.status, a.id AS "accountId", credit.amount AS "creditMinor",
           COALESCE(credit."createdAt", d."updatedAt") AS at,
           CASE
             WHEN d.method = 'USDT' THEN COALESCE(d."amountUsdtMinor", 0)::numeric * ${USD_INR_RATE}
             WHEN credit.amount IS NOT NULL AND credit.amount = d."amountInr" AND credit.amount <> d."amountUsd"
               THEN credit.amount
             WHEN credit.amount IS NOT NULL AND credit.amount = d."amountUsd" AND credit.amount <> d."amountInr"
               THEN credit.amount::numeric * ${USD_INR_RATE}
             WHEN (
               (a.currency IN ('USD', 'USDT')) <>
               (credit.amount IS NOT NULL AND (
                 SELECT COUNT(*) % 2 = 1 FROM "Transaction" switch
                 WHERE switch."accountId" = a.id AND switch.kind = 'CURRENCY_CONVERT'
                   AND switch."createdAt" > credit."createdAt"
               ))
             ) THEN COALESCE(credit.amount, d."amountUsd")::numeric * ${USD_INR_RATE}
             ELSE COALESCE(credit.amount, d."amountInr")
           END AS minor
    FROM referrals r
    JOIN "Account" a ON a."userId" = r."userId" AND a.type = 'LIVE'
    JOIN "Deposit" d ON d."userId" = r."userId" AND d.status IN ('COMPLETED', 'REJECTED')
    LEFT JOIN LATERAL (
      SELECT t."createdAt", t.amount FROM "Transaction" t
      WHERE t."accountId" = a.id AND t."refId" = d.id
        AND t.kind = 'DEPOSIT' AND t."refType" = 'Deposit' AND t.amount > 0
      ORDER BY t."createdAt", t.id LIMIT 1
    ) credit ON TRUE
    WHERE credit.amount IS NOT NULL OR (
      d.status = 'COMPLETED' AND NOT EXISTS (
        SELECT 1 FROM "Account" other
        JOIN "Transaction" t ON t."accountId" = other.id AND t."refId" = d.id
          AND t.kind = 'DEPOSIT' AND t."refType" = 'Deposit' AND t.amount > 0
        WHERE other."userId" = r."userId" AND other.type <> 'LIVE'
      )
    )
  ),
  first_deposits AS (
    SELECT DISTINCT ON ("userId") "userId", id, status, at, minor
    FROM live_deposits WHERE minor > 0
    ORDER BY "userId", at, id
  )`;
