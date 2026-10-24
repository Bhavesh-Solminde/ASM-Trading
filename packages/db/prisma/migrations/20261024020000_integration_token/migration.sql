-- IntegrationToken: per-provider access-token store for third-party integrations
-- (FYERS first — NSE/BSE market data for Indian indices). Daily-expiring OAuth
-- tokens that the admin re-authorizes via a browser round-trip. Tokens are
-- NEVER committed, NEVER logged, and NEVER surfaced to the client bundle; this
-- row is read only by server-side code with a service-role DB connection.
CREATE TABLE "IntegrationToken" (
  "provider"     TEXT NOT NULL,
  "accessToken"  TEXT NOT NULL,
  "refreshToken" TEXT,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationToken_pkey" PRIMARY KEY ("provider")
);
