create or replace function public.admin_reporting_summary(p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with bounds as (
  select greatest(1, least(coalesce(p_days, 30), 365))::integer as days,
         now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365))) as since_at
),
filtered as (
  select c.*
  from public.clicks c cross join bounds b
  where c.created_at >= b.since_at
),
totals as (
  select
    count(*) filter (where not is_bot) as genuine_clicks,
    count(*) filter (where is_bot) as bot_clicks,
    count(distinct visitor_hash) filter (where not is_bot and visitor_hash is not null) as visitor_days,
    count(distinct event_id) filter (where not is_bot) as events_with_clicks
  from filtered
),
by_event as (
  select coalesce(jsonb_agg(to_jsonb(x) order by x.genuine_clicks desc, x.title), '[]'::jsonb) as data
  from (
    select e.id, e.title, e.slug, e.city, e.status,
      count(f.id) filter (where not f.is_bot) as genuine_clicks,
      count(f.id) filter (where f.is_bot) as bot_clicks,
      count(distinct f.visitor_hash) filter (where not f.is_bot and f.visitor_hash is not null) as visitor_days
    from public.events e
    left join filtered f on f.event_id = e.id
    group by e.id, e.title, e.slug, e.city, e.status
  ) x
),
by_source as (
  select coalesce(jsonb_agg(to_jsonb(x) order by x.genuine_clicks desc), '[]'::jsonb) as data
  from (
    select coalesce(src, 'other') as source,
      count(*) filter (where not is_bot) as genuine_clicks,
      count(*) filter (where is_bot) as bot_clicks
    from filtered group by coalesce(src, 'other')
  ) x
),
by_country as (
  select coalesce(jsonb_agg(to_jsonb(x) order by x.genuine_clicks desc), '[]'::jsonb) as data
  from (
    select coalesce(nullif(country, ''), 'Unknown') as country,
      count(*) filter (where not is_bot) as genuine_clicks
    from filtered group by coalesce(nullif(country, ''), 'Unknown')
  ) x
),
by_device as (
  select coalesce(jsonb_agg(to_jsonb(x) order by x.genuine_clicks desc), '[]'::jsonb) as data
  from (
    select coalesce(device_type, 'unknown') as device_type,
      count(*) filter (where not is_bot) as genuine_clicks
    from filtered group by coalesce(device_type, 'unknown')
  ) x
),
daily as (
  select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) as data
  from (
    select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
      count(*) filter (where not is_bot) as genuine_clicks,
      count(*) filter (where is_bot) as bot_clicks
    from filtered group by date_trunc('day', created_at)
  ) x
)
select jsonb_build_object(
  'days', (select days from bounds),
  'since', (select since_at from bounds),
  'generated_at', now(),
  'totals', (select to_jsonb(totals) from totals),
  'by_event', (select data from by_event),
  'by_source', (select data from by_source),
  'by_country', (select data from by_country),
  'by_device', (select data from by_device),
  'daily', (select data from daily)
);
$$;

revoke all on function public.admin_reporting_summary(integer) from public, anon, authenticated;
grant execute on function public.admin_reporting_summary(integer) to service_role;
