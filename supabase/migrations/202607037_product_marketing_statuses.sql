alter table public."Produto"
  add column if not exists lancamento boolean not null default false,
  add column if not exists promocao boolean not null default false;

comment on column public."Produto".lancamento is 'Exibe o produto na seção de lançamentos do aplicativo.';
comment on column public."Produto".promocao is 'Exibe o produto na seção de promoções do aplicativo.';

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
    || jsonb_build_object('lancamento', p.lancamento)
    || jsonb_build_object('promocao', p.promocao)
    || jsonb_build_object('ordem', p.ordem)
    || jsonb_build_object('categoriaId', p."categoriaId")
    || jsonb_build_object('marcaId', p."marcaId")
    || jsonb_build_object('createdAt', p."createdAt")
    || jsonb_build_object('updatedAt', p."updatedAt");
end;
$$;
