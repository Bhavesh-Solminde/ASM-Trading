-- Runs once on first Postgres boot (empty PGDATA).
-- Creates the two roles the app expects:
--   asm_owner - DDL (migrations)
--   asm_app   - DML (runtime)

\set owner_password `echo "$POSTGRES_OWNER_PASSWORD"`
\set app_password   `echo "$POSTGRES_APP_PASSWORD"`

CREATE ROLE asm_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE asm_app   LOGIN PASSWORD :'app_password';

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
