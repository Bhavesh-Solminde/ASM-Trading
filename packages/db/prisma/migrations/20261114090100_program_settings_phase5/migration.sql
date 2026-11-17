-- Launch defaults for the program withdrawal rules and affiliate approval (separate
-- migration: enum values added in the previous one can't be used in the same transaction).
-- The withdrawal-count limits were not supplied by the business (requirements §17); these are
-- conservative placeholders that admin can change from the Affiliate program settings page.
INSERT INTO "ProgramSetting" ("id", "key", "value", "effectiveFrom", "createdBy", "reason") VALUES
  (gen_random_uuid()::text, 'PROGRAM_MIN_WITHDRAWAL_INR_MINOR', 199900, '1970-01-01 00:00:00', 'migration', 'Launch default: minimum program withdrawal ₹1,999'),
  (gen_random_uuid()::text, 'PROGRAM_WITHDRAWALS_PER_DAY', 1, '1970-01-01 00:00:00', 'migration', 'Placeholder until admin sets it: 1 request per IST day'),
  (gen_random_uuid()::text, 'PROGRAM_WITHDRAWALS_PER_WEEK', 3, '1970-01-01 00:00:00', 'migration', 'Placeholder until admin sets it: 3 requests per Monday–Sunday week'),
  (gen_random_uuid()::text, 'PROGRAM_WITHDRAWALS_PER_MONTH', 5, '1970-01-01 00:00:00', 'migration', 'Placeholder until admin sets it: 5 requests per calendar month'),
  (gen_random_uuid()::text, 'AFFILIATE_REQUIRES_APPROVAL', 0, '1970-01-01 00:00:00', 'migration', 'Launch default: email verification activates affiliates immediately');
