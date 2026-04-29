create table if not exists public.push_activation_logs (
  id bigint generated always as identity primary key,
  usuario_id uuid references public.usuarios(id) on delete set null,
  usuario_rol text,
  event text not null,
  level text not null check (level in ('info', 'warn', 'error')),
  message text,
  details jsonb not null default '{}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_activation_logs_created_at_idx
  on public.push_activation_logs (created_at desc);

create index if not exists push_activation_logs_usuario_idx
  on public.push_activation_logs (usuario_id, created_at desc);

create index if not exists push_activation_logs_level_idx
  on public.push_activation_logs (level, created_at desc);

alter table public.push_activation_logs enable row level security;
