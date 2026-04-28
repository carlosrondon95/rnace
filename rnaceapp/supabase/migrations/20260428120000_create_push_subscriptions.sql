create table if not exists public.push_subscriptions (
  subscription_id text primary key,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  onesignal_id text,
  external_id text,
  token text,
  opted_in boolean not null default true,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_usuario_active_idx
  on public.push_subscriptions (usuario_id, last_seen_at desc)
  where opted_in = true;

create index if not exists push_subscriptions_external_id_idx
  on public.push_subscriptions (external_id);

alter table public.push_subscriptions enable row level security;
