create table if not exists messages (
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

create index if not exists messages_created_at_idx on messages (created_at desc);
