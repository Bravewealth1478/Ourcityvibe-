-- Phase 3.1: multi-source event discovery foundation
-- Existing events remain the approved/live event table. Imported candidates
-- are stored separately until an administrator approves them.

create table if not exists public.event_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null check (source_type in ('api','rss','ical','website','directory','manual')),
  base_url text not null,
  enabled boolean not null default true,
  country_scope text not null default 'global' check (country_scope in ('global','country','regional','local')),
  country_codes text[] not null default '{}',
  config jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_sources_base_url_http check (base_url ~* '^https?://')
);

create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.event_sources(id) on delete set null,
  trigger_type text not null default 'scheduled' check (trigger_type in ('scheduled','manual','retry')),
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_seen integer not null default 0 check (items_seen >= 0),
  items_created integer not null default 0 check (items_created >= 0),
  items_updated integer not null default 0 check (items_updated >= 0),
  duplicates_found integer not null default 0 check (duplicates_found >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.discovered_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.event_sources(id) on delete restrict,
  discovery_run_id uuid references public.discovery_runs(id) on delete set null,
  external_id text,
  title text not null,
  description text,
  category text,
  organizer_name text,
  venue_name text,
  address text,
  city text,
  region text,
  country text,
  country_code text,
  timezone text,
  event_date timestamptz,
  end_date timestamptz,
  ticket_url text,
  source_url text,
  image_url text,
  currency text,
  price_min numeric(12,2),
  price_max numeric(12,2),
  popularity_score numeric(6,2) not null default 0 check (popularity_score between 0 and 100),
  popularity_signals jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected','duplicate')),
  duplicate_of uuid references public.discovered_events(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  approved_event_id uuid references public.events(id) on delete set null,
  source_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovered_events_title_not_blank check (length(trim(title)) > 0),
  constraint discovered_events_date_order check (end_date is null or event_date is null or end_date >= event_date),
  constraint discovered_events_country_code check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint discovered_events_ticket_url_http check (ticket_url is null or ticket_url ~* '^https?://'),
  constraint discovered_events_source_url_http check (source_url is null or source_url ~* '^https?://'),
  constraint discovered_events_image_url_http check (image_url is null or image_url ~* '^https?://'),
  constraint discovered_events_source_external_unique unique (source_id, external_id)
);

alter table public.events
  add column if not exists discovered_event_id uuid references public.discovered_events(id) on delete set null,
  add column if not exists description text,
  add column if not exists venue_name text,
  add column if not exists region text,
  add column if not exists country text,
  add column if not exists country_code text,
  add column if not exists timezone text,
  add column if not exists organizer_name text,
  add column if not exists source_url text;

create unique index if not exists events_discovered_event_id_uidx
  on public.events(discovered_event_id) where discovered_event_id is not null;
create index if not exists event_sources_enabled_idx on public.event_sources(enabled, source_type);
create index if not exists discovery_runs_source_started_idx on public.discovery_runs(source_id, started_at desc);
create index if not exists discovered_events_review_date_idx on public.discovered_events(review_status, event_date);
create index if not exists discovered_events_location_idx on public.discovered_events(country_code, city);
create index if not exists discovered_events_fingerprint_idx on public.discovered_events(fingerprint);
create index if not exists discovered_events_popularity_idx on public.discovered_events(popularity_score desc, event_date);
create index if not exists discovered_events_source_seen_idx on public.discovered_events(source_id, last_seen_at desc);

alter table public.event_sources enable row level security;
alter table public.discovery_runs enable row level security;
alter table public.discovered_events enable row level security;

revoke all on public.event_sources from anon, authenticated;
revoke all on public.discovery_runs from anon, authenticated;
revoke all on public.discovered_events from anon, authenticated;

grant all on public.event_sources to service_role;
grant all on public.discovery_runs to service_role;
grant all on public.discovered_events to service_role;
