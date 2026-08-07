create or replace function public.get_admin_product_permissions()
returns setof public."ProductFieldPermission"
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'Apenas o administrador principal pode consultar as permissões.'
      using errcode = '42501';
  end if;

  return query
  select permission.*
  from public."ProductFieldPermission" permission
  order by permission."fieldLabel";
end;
$$;

revoke all on function public.get_admin_product_permissions() from public;
grant execute on function public.get_admin_product_permissions() to authenticated;
