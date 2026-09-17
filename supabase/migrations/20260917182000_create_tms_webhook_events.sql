-- Raw webhook log untuk diagnosis event McEasy.
-- Menyimpan semua payload masuk walaupun belum bisa dinormalisasi.

create table if not exists public.tms_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mceasy',
  event_type text,
  http_method text,
  user_agent text,
  payload jsonb,
  payload_valid boolean not null default true,
  payload_error text,
  normalized_count integer not null default 0,
  received_at timestamptz not null default now()
);

create index if not exists tms_webhook_events_received_at_idx
  on public.tms_webhook_events (received_at desc);

create index if not exists tms_webhook_events_provider_time_idx
  on public.tms_webhook_events (provider, received_at desc);

alter table public.tms_webhook_events enable row level security;
