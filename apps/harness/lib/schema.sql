create table if not exists relay_messages (
  id bigint generated always as identity primary key,
  device_label text,
  device_model text,
  sender text not null,
  body text not null,
  received_at timestamptz not null,
  amount_inr integer,
  utr text,
  is_credit boolean,
  created_at timestamptz not null default now()
);

create index if not exists relay_messages_created_at_idx on relay_messages (created_at desc);

-- Postgres treats NULLs as never conflicting, so multiple messages with no
-- parseable UTR still insert fine — this only rejects an exact-duplicate
-- non-null UTR, a safety net alongside the device-side checkpoint that
-- already prevents the relay app from resending anything.
create unique index if not exists relay_messages_utr_idx on relay_messages (utr);
