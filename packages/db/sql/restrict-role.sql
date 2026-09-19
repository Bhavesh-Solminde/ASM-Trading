-- Runtime role: DML only. No DDL, no GRANT, no schema ownership.
REVOKE ALL ON SCHEMA public FROM asm_app;
GRANT USAGE ON SCHEMA public TO asm_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO asm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO asm_app;

-- Tables created by future migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES FOR ROLE asm_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO asm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE asm_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO asm_app;

-- AuditLog is append-only even for the runtime role.
REVOKE UPDATE, DELETE ON "AuditLog" FROM asm_app;
