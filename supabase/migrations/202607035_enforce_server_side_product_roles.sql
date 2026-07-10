-- Security: never trust a role supplied by a client when exposing product fields.
create or replace function public.visible_product_json(p public."Produto", requested_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  authenticated_role text := lower(public.current_app_role());
  role_key text;
  payload jsonb := '{}'::jsonb;
  allow_field boolean;
  field record;
  source jsonb := to_jsonb(p);
begin
  -- Admins may inspect every field. Every other caller is bound to the role
  -- resolved on the server from auth.uid(); requested_role is intentionally ignored.
  if authenticated_role in ('admin', 'admin_master', 'admin_colaborador') then
    return source;
  end if;
  role_key := case
    when authenticated_role in ('visitante', 'nao_cliente', 'cliente', 'representante') then authenticated_role
    else 'visitante'
  end;

  for field in select * from public."ProductFieldPermission"
  loop
    allow_field := case role_key
      when 'visitante' then field."visibleToVisitor"
      when 'nao_cliente' then field."visibleToNonClient"
      when 'cliente' then field."visibleToClient"
      when 'representante' then field."visibleToRepresentative"
      else false
    end;

    if allow_field and source ? field."fieldKey" then
      payload := payload || jsonb_build_object(field."fieldKey", source -> field."fieldKey");
    end if;
  end loop;

  return payload
    || jsonb_build_object('id', p.id)
    || jsonb_build_object('ativo', p.ativo)
    || jsonb_build_object('destaque', p.destaque)
    || jsonb_build_object('ordem', p.ordem)
    || jsonb_build_object('categoriaId', p."categoriaId")
    || jsonb_build_object('marcaId', p."marcaId")
    || jsonb_build_object('createdAt', p."createdAt")
    || jsonb_build_object('updatedAt', p."updatedAt");
end;
$$;

create or replace function public.get_visible_products(requested_role text default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.visible_product_json(p, null)
  from public."Produto" p
  where p.ativo = true or public.can_manage_catalog()
  order by p.ordem asc, p.nome asc;
$$;

create or replace function public.get_visible_product(product_id text, requested_role text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.visible_product_json(p, null)
  from public."Produto" p
  where p.id = product_id
    and (p.ativo = true or public.can_manage_catalog())
  limit 1;
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.is_admin_master() from public;
revoke all on function public.is_admin_collaborator() from public;
revoke all on function public.can_manage_catalog() from public;
revoke all on function public.can_read_leads() from public;
grant execute on function public.current_app_role() to anon, authenticated;
grant execute on function public.is_admin_master() to authenticated;
grant execute on function public.is_admin_collaborator() to authenticated;
grant execute on function public.can_manage_catalog() to authenticated;
grant execute on function public.can_read_leads() to authenticated;

revoke all on function public.save_app_setting(text, jsonb) from public;
grant execute on function public.save_app_setting(text, jsonb) to authenticated;
