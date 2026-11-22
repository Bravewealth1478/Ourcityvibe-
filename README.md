# OurCityVibe Event Promo Tracker

Phase 1 tracked links and click logging, plus Phase 2 password-protected event administration.

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
- Phase 2 adds a protected admin dashboard for event creation, editing, archiving and tracked-link copying.
- Automated event discovery remains out of scope.

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

## Phase 2 admin dashboard
1. Run [sql/phase2_event_image.sql](sql/phase2_event_image.sql) and [sql/phase2_admin_stats.sql](sql/phase2_admin_stats.sql) in the Supabase SQL Editor after the Phase 1 schema.
2. Add `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` to the Netlify site's environment variables with the Functions scope. Mark both as secret. Use a strong password and a separate random session secret (for example, generate it locally with `openssl rand -hex 32`).
3. Keep all four server-side variables private: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET`.
4. Redeploy the Netlify site, then visit `/admin`.
5. Create an event and test each generated source link. Editing an event keeps its existing slug; archiving makes the tracked redirect inactive.

The dashboard's statistics are aggregated in Postgres by a restricted function. Visitor-days are based on the Phase 1 daily visitor hash. The same person can count once on different days; this is not a lifetime unique-person metric.

## Phase boundary
Phase 1 and Phase 2 are included in this repository. Automated Ticketmaster discovery, richer reports and AI caption drafting remain out of scope until the current phases are deployed and tested.