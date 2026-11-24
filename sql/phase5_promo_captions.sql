-- Phase 5: AI-generated promotional caption drafts
create table if not exists public.event_promo_captions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  caption text not null,
  short_caption text not null,
  affiliate_disclosure text,
  status text not null default 'draft' check (status in ('draft','approved')),
  model text,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists event_promo_captions_status_updated_idx on public.event_promo_captions(status, updated_at desc);
alter table public.event_promo_captions enable row level security;
revoke all on public.event_promo_captions from anon, authenticated;
