-- Bound public telemetry payloads and provide a service-only retention routine.
alter table public."AppTelemetryEvent"
  drop constraint if exists "AppTelemetryEvent_payload_limits";

alter table public."AppTelemetryEvent"
  add constraint "AppTelemetryEvent_payload_limits" check (
    length("eventType") between 1 and 80
    and coalesce(length(screen), 0) <= 120
    and coalesce(length(route), 0) <= 120
    and coalesce(length("userId"), 0) <= 128
    and coalesce(length("userRole"), 0) <= 40
    and coalesce(length(message), 0) <= 1000
    and coalesce(octet_length(metadata::text), 0) <= 16384
    and ("durationMs" is null or "durationMs" between 0 and 86400000)
  );

create or replace function public.purge_old_telemetry(retention_days integer default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  if retention_days < 7 or retention_days > 365 then
    raise exception 'retention_days must be between 7 and 365';
  end if;

  delete from public."AppTelemetryEvent"
  where "createdAt" < now() - make_interval(days => retention_days);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_old_telemetry(integer) from public;
grant execute on function public.purge_old_telemetry(integer) to service_role;

comment on function public.purge_old_telemetry(integer) is
  'Delete telemetry older than the configured retention window. Schedule daily with Supabase Cron using the service role.';
