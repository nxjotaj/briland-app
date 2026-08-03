-- Uma única fonte segura para as permissões efetivas do catálogo.
-- O perfil é resolvido no servidor; clientes não podem solicitar permissões de outro papel.
create or replace function public.get_current_product_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with effective_role as (
    select case lower(coalesce(public.current_app_role(), 'visitante'))
      when 'admin' then 'admin'
      when 'admin_master' then 'admin_master'
      when 'admin_colaborador' then 'admin_colaborador'
      when 'nao_cliente' then 'nao_cliente'
      when 'cliente' then 'cliente'
      when 'representante' then 'representante'
      else 'visitante'
    end as role_key
  )
  select coalesce(jsonb_object_agg(p."fieldKey",
    case r.role_key
      when 'admin' then true
      when 'admin_master' then true
      when 'admin_colaborador' then true
      when 'visitante' then coalesce(p."visibleToVisitor", false)
      when 'nao_cliente' then coalesce(p."visibleToNonClient", false)
      when 'cliente' then coalesce(p."visibleToClient", false)
      when 'representante' then coalesce(p."visibleToRepresentative", false)
      else false
    end
  ), '{}'::jsonb)
  from public."ProductFieldPermission" p
  cross join effective_role r;
$$;

revoke all on function public.get_current_product_permissions() from public;
grant execute on function public.get_current_product_permissions() to anon, authenticated;

-- Compatibilidade imediata com versões nativas já instaladas, que leem a
-- matriz no próprio produto. A matriz continua sendo resolvida no servidor.
create or replace function public.visible_product_json(
  p public."Produto",
  requested_role text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  authenticated_role text := lower(public.current_app_role());
  role_key text;
  payload jsonb := '{}'::jsonb;
  allow_field boolean;
  field record;
  source jsonb := to_jsonb(p);
  role_permissions jsonb := public.get_current_product_permissions();
begin
  if authenticated_role in ('admin', 'admin_master', 'admin_colaborador') then
    return source || jsonb_build_object('permissoesProduto', role_permissions);
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
    || jsonb_build_object('lancamento', p.lancamento)
    || jsonb_build_object('promocao', p.promocao)
    || jsonb_build_object('ordem', p.ordem)
    || jsonb_build_object('categoriaId', p."categoriaId")
    || jsonb_build_object('marcaId', p."marcaId")
    || jsonb_build_object('imagemCard', p."imagemCard")
    || jsonb_build_object('imagemDetalhe', p."imagemDetalhe")
    || jsonb_build_object('imagensExtras', to_jsonb(coalesce(p."imagensExtras", array[]::text[])))
    || jsonb_build_object('createdAt', p."createdAt")
    || jsonb_build_object('updatedAt', p."updatedAt")
    || jsonb_build_object('permissoesProduto', role_permissions);
end;
$function$;
