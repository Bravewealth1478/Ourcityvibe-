# OurCityVibe Event Promo Tracker

Phase 1 tracked links and click logging, Phase 2 password-protected event administration, and the Phase 3 multi-source event discovery foundation.

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
- Phase 3.1 adds private tables for event sources, discovery runs, and imported event candidates. Imported candidates remain separate from live events until administrator approval.

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

## Phase 3.1 multi-source discovery foundation
Run [sql/phase3_multisource_discovery.sql](sql/phase3_multisource_discovery.sql) after the Phase 1 and Phase 2 SQL files. It creates:
- `event_sources`: source registry for APIs, RSS, iCal, websites, directories and manual feeds, with global or scoped coverage.
- `discovery_runs`: import execution history and item counts.
- `discovered_events`: normalised imported candidates, source provenance, location, dates, popularity signals, fingerprints and review status.
- Optional metadata columns on `events` so approved imports can retain their provenance and event details.

All three discovery tables have RLS enabled, no privileges for `anon` or `authenticated`, and server-only `service_role` grants. Imported candidates default to `pending`; they do not create active tracked links automatically. The schema is a foundation only: source adapters, duplicate matching, approval UI, popularity scoring and scheduled collection are subsequent Phase 3 steps.

## Phase 3.2 source adapter layer
The first adapter module is [api/discovery/adapters.js](api/discovery/adapters.js). It provides normalisation and parsers for:
- JSON APIs, including an optional `config.items_path` for nested event arrays.
- RSS and Atom feeds.
- iCalendar feeds (`VEVENT` records).
- Website and directory pages that publish Schema.org Event JSON-LD.

The adapters return a common event candidate shape. They do not publish or approve events. Collection is bounded by a 12-second request timeout and 2 MB response limit, follows at most three redirects, and rejects obvious private/reserved host targets after DNS resolution. Before enabling arbitrary user-supplied source URLs in a live admin workflow, the fetch layer still needs production-grade DNS pinning/SSRF hardening and source-specific permission checks. iCalendar timezone handling and provider-specific API field mappings will be refined as sources are onboarded.

No source is activated automatically by this module. A source must be configured and enabled by an administrator in a later dashboard step.

## Phase boundary
Phase 1 and Phase 2 remain in place. Phase 3 is being implemented in stages. Phase 4 reporting and Phase 5 AI-assisted caption drafting remain out of scope until Phase 3 is complete and tested.

## Phase 3.2 discovery adapters
The server-side adapter module in `api/discovery/adapters.js` normalises JSON API responses, RSS/Atom feeds, iCalendar VEVENT entries, and Schema.org Event JSON-LD from web pages into a common event candidate shape. Parser tests run in GitHub Actions.

The fetch layer now resolves each source host, rejects private/reserved addresses, and pins each HTTP(S) request to the validated address to prevent a second DNS lookup from rebinding the connection. Each redirect is revalidated and pinned independently. It also enforces request timeouts, a 2 MB response limit, a three-redirect limit, and source-specific content-type allowlists. Automated tests cover private/reserved IP blocking and content-type policy. Before broad production collection, still add stricter host allowlisting/source permissions, rate limits, and robust iCalendar TZID timezone conversion.

## Phase 3.3 source registry administration
The protected admin dashboard now includes an Event discovery sources panel. Administrators can register and edit API, RSS, iCalendar, website, directory, and manual sources; set global or country/regional/local coverage; supply two-letter country codes; store JSON adapter configuration; and enable or disable sources. The service-role key remains server-side.

Registering a source does not fetch it. Automated collection, candidate review, and approval-to-live-event workflows are still separate upcoming Phase 3 steps. Discovered candidates must never be published automatically.


## Phase 3.5 manual event collection
Authenticated administrators can run one enabled source or collect through the enabled source registry in small batches. The collector uses the hardened adapters, records a `discovery_runs` row for each source attempt, and stores normalised records in `discovered_events`. It refreshes repeat records by source/external ID or source fingerprint, updates first/last-seen metadata, and flags matching fingerprints from another source as duplicates. Collection results and source errors are shown in the admin dashboard.

Collection is deliberately manual at this stage. It is not scheduled, does not publish to `events`, and does not create tracked links. Manual-only source records are excluded from automated fetching. The collector processes three sources per request and paginates through the registry to avoid an unbounded single request. Candidates remain pending review unless a cross-source fingerprint match marks them as duplicates.


## Phase 3.6 candidate review and approval
The admin dashboard now includes a pending candidate review queue. Each card shows source, date/location details, description and available image, plus a source listing link. Administrators can supply or correct the ticket/official event URL, approve the candidate, or reject it. Approval creates a normal active row in `events` with a unique tracked slug and links it to the discovery candidate; only then does the event appear in the existing tracked-events dashboard. Candidates without a valid HTTP(S) ticket/event URL cannot be approved. Rejection only changes review status and does not delete source data.

The review queue is separate from collection. No candidate is automatically approved or published. The admin must manually inspect each candidate before creating its tracked event.


## One-click event discovery experience
The admin dashboard now presents a primary **Fetch Events** action. The source registry and source editor are tucked under **Advanced source settings**, so normal operation does not require configuring feeds. The first built-in directory set is seeded in Supabase and includes Eventbrite structured-data event listing pages for Lagos, Abuja, Ibadan, Accra, Dubai, London, New York, and Toronto. Fetch Events runs enabled sources in bounded batches and places extracted candidates into the review queue; it never publishes automatically. Additional providers and cities can be added through advanced settings as their source access and reliability are verified.

The built-in directory set is an initial coverage layer, not a guarantee that every page will return data on every run. Some event directories may block automated requests or change their markup; per-source outcomes are visible in collection results. Broader coverage requires additional independent providers and, where applicable, API credentials.
