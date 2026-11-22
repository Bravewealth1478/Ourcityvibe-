create or replace function public.admin_event_click_stats()
returns table (
  event_id uuid,
  genuine_clicks bigint,
  unique_visitors bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.event_id,
    count(*) filter (where c.is_bot = false) as genuine_clicks,
    count(distinct c.visitor_hash) filter (
      where c.is_bot = false and c.visitor_hash is not null
    ) as unique_visitors
  from public.clicks as c
  group by c.event_id;
$$;

revoke all on function public.admin_event_click_stats() from public, anon, authenticated;
grant execute on function public.admin_event_click_stats() to service_role;