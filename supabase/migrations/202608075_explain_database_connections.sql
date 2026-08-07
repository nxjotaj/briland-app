create or replace function public.get_admin_capacity_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
  maximum_connections integer := current_setting('max_connections')::integer;
  current_connections integer;
  active_connections integer;
  idle_connections integer;
  internal_connections integer;
begin
  if not public.is_admin_master() then
    raise exception 'Somente o administrador principal pode consultar a capacidade do sistema.'
      using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(*) filter (where state = 'active')::integer,
    count(*) filter (where state = 'idle')::integer,
    count(*) filter (where state is null)::integer
  into current_connections, active_connections, idle_connections, internal_connections
  from pg_stat_activity;

  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'storageBytes', coalesce((
      select sum(coalesce((object.metadata ->> 'size')::bigint, 0))
      from storage.objects object
    ), 0),
    'currentConnections', current_connections,
    'activeConnections', active_connections,
    'idleConnections', idle_connections,
    'internalConnections', internal_connections,
    'availableConnections', greatest(maximum_connections - current_connections, 0),
    'maxConnections', maximum_connections,
    'generatedAt', now()
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_admin_capacity_health() from public;
grant execute on function public.get_admin_capacity_health() to authenticated;
