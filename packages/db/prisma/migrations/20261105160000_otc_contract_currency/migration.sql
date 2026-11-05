ALTER TABLE "Trade" ADD COLUMN "currency" TEXT;
UPDATE "Trade" t SET "currency"=a.currency FROM "Account" a
WHERE t."accountId"=a.id AND t.mode='OTC_FIXED';
UPDATE "MarketCommand" m SET input=jsonb_set(m.input, '{currency}', to_jsonb(a.currency))
FROM "Account" a WHERE m."accountId"=a.id AND m.input->>'kind'='open' AND NOT (m.input ? 'currency');
