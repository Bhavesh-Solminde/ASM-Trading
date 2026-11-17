-- Launch value of the default Revenue Share (enum value added in the previous migration).
INSERT INTO "ProgramSetting" ("id", "key", "value", "effectiveFrom", "createdBy", "reason") VALUES
  (gen_random_uuid()::text, 'DEFAULT_REVENUE_SHARE_BPS', 0, '1970-01-01 00:00:00', 'migration', 'Launch default: 0% until the business sets a default Revenue Share');
