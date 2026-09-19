-- Runs once on first Postgres boot (empty PGDATA).
-- Creates the two roles the app expects:
--   asm_owner - DDL (migrations)
--   asm_app   - DML (runtime)

\set owner_password `echo "$POSTGRES_OWNER_PASSWORD"`
\set app_password   `echo "$POSTGRES_APP_PASSWORD"`

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asm_owner') THEN
    EXECUTE format('CREATE ROLE asm_owner LOGIN PASSWORD %L', :'owner_password');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asm_app') THEN
    EXECUTE format('CREATE ROLE asm_app LOGIN PASSWORD %L', :'app_password');
  END IF;
END
$$;

-- Ownership of the app database goes to asm_owner so migrations can DDL.
ALTER DATABASE asm_trade OWNER TO asm_owner;

\connect asm_trade

-- Public schema owned by asm_owner; asm_app gets DML on tables it creates.
ALTER SCHEMA public OWNER TO asm_owner;
GRANT USAGE ON SCHEMA public TO asm_app;

-- Default privileges: anything asm_owner creates in `public` is usable by asm_app.
ALTER DEFAULT PRIVILEGES FOR ROLE asm_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO asm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE asm_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO asm_app;
