create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  ticket_url text not null check (ticket_url ~* '^https?://'),
  platform text not null default 'other' check (platform in ('ticketmaster','eventbrite','posh','other')),
  city text,
  event_date timestamptz,
  slug text not null unique check (slug ~ '^[a-z0-9-]{4,40}$'),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.clicks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  referrer text,
  src text not null default 'other' check (src in ('instagram','tiktok','whatsapp','x','facebook','other')),
  device_type text not null default 'unknown' check (device_type in ('mobile','tablet','desktop','unknown')),
  country text,
  visitor_hash text,
  is_bot boolean not null default false
);

create index if not exists events_slug_active_idx on public.events (slug) where status = 'active';
create index if not exists clicks_event_created_idx on public.clicks (event_id, created_at desc);
create index if not exists clicks_event_source_idx on public.clicks (event_id, src);
create index if not exists clicks_visitor_hash_idx on public.clicks (visitor_hash) where visitor_hash is not null;
create index if not exists clicks_non_bot_idx on public.clicks (event_id, created_at desc) where is_bot = false;

alter table public.events enable row level security;
alter table public.clicks enable row level security;

revoke all on public.events from anon, authenticated;
revoke all on public.clicks from anon, authenticated;
grant all on public.events to service_role;
grant all on public.clicks to service_role;