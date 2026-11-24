-- Phase 3 hardening: keep the automatic RLS event-trigger function
-- unavailable to browser roles and index the discovery foreign keys.
--
-- The trigger remains installed for database-owner DDL operations. It is not
-- intended to be callable through the Supabase Data API.

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS discovered_events_approved_event_idx
  ON public.discovered_events(approved_event_id);

CREATE INDEX IF NOT EXISTS discovered_events_discovery_run_idx
  ON public.discovered_events(discovery_run_id);

CREATE INDEX IF NOT EXISTS discovered_events_duplicate_of_idx
  ON public.discovered_events(duplicate_of);
