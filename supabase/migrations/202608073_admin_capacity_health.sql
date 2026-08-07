create or replace function public.get_admin_capacity_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if not public.is_admin_master() then
    raise exception 'Somente o administrador principal pode consultar a capacidade do sistema.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'storageBytes', coalesce((
      select sum(coalesce((object.metadata ->> 'size')::bigint, 0))
      from storage.objects object
    ), 0),
    'currentConnections', (select count(*) from pg_stat_activity),
    'activeConnections', (select count(*) from pg_stat_activity where state = 'active'),
    'maxConnections', current_setting('max_connections')::integer,
    'generatedAt', now()
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_admin_capacity_health() from public;
grant execute on function public.get_admin_capacity_health() to authenticated;
