# OurCityVibe Event Promo Tracker

Phase 1 foundation for tracked event links and click logging.

## Stack
- Static HTML/CSS frontend
- Netlify Edge Function at `/go/:slug`
- Supabase Postgres for events and click records
- GitHub as the source repository

## Phase 1 scope
- Look up active event slugs and redirect to the event ticket page.
- Record source, referrer, device category, country, bot flag and a daily visitor hash.
- Save known bot and preview requests with `is_bot=true`; exclude them from genuine click totals.
- Do not store raw IP addresses or user-agent strings.
- No admin dashboard or event discovery automation in this phase.

## Supabase setup
1. Create or select a Supabase project.
2. Open the SQL Editor and run [sql/schema.sql](sql/schema.sql).
3. Keep the tables private. RLS is enabled and the browser roles have no table privileges.
4. Add an event manually for Phase 1:

```sql
insert into public.events (title, ticket_url, platform, city, event_date, slug)
values ('Test Event', 'https://example.com/tickets', 'other', 'Abeokuta',
        now() + interval '7 days', 'test-event-01');
```

## Netlify environment variables
Set these on the Netlify site with the **Functions** scope:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret)
- `VISITOR_HASH_SECRET` (secret; use a long random value)

Never put the service role key or hash secret in frontend code or commit their values. Changing variables requires a new deploy.

Generate a hash secret locally with `openssl rand -hex 32`.

## Deploy
- Connect this GitHub repository to Netlify.
- Production branch: `main`.
- Build command: leave empty.
- Publish directory: `public`.
- Edge Functions directory: `netlify/edge-functions`.
- Deploy after setting the environment variables.

## Tracked link format
`https://YOUR_SITE.netlify.app/go/test-event-01?src=instagram`

Supported `src` values: `instagram`, `tiktok`, `whatsapp`, `x`, `facebook`, `other`.

## Verification checklist
- [ ] Run the schema in Supabase.
- [ ] Insert a test event.
- [ ] Set all three Netlify environment variables and redeploy.
- [ ] Test a normal browser click and confirm a 302 redirect.
- [ ] Test Instagram, TikTok, WhatsApp, Facebook and X links with their source parameters.
- [ ] Test a WhatsApp link preview separately from a real tap; inspect bot classification.
- [ ] Test an unknown slug and an archived event.
- [ ] Confirm bot rows are marked and excluded from genuine click totals.
- [ ] Confirm no raw IP or user-agent value is stored.

## Reporting examples

Genuine clicks:
```sql
select event_id, count(*) as genuine_clicks
from public.clicks
where is_bot = false
group by event_id;
```

Daily unique visitors (daily hash is used, so the same visitor on different days counts once per day):
```sql
select event_id, count(distinct visitor_hash) as daily_unique_visitors
from public.clicks
where is_bot = false and visitor_hash is not null
group by event_id;
```

Clicks by source:
```sql
select event_id, src, count(*) as clicks
from public.clicks
where is_bot = false
group by event_id, src
order by event_id, clicks desc;
```

## Phase boundary
This repository currently contains Phase 1 only. Admin dashboard, automated event discovery, reports UI and AI caption drafting remain out of scope until Phase 1 is deployed and tested.