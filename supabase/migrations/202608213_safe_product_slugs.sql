-- Product names and codes keep their commercial notation (for example 195/65R15).
-- Only the URL slug is normalized so reserved URL characters cannot split the route.
create or replace function public.normalize_product_slug(value text)
returns text
language sql
immutable
strict
as $$
  select trim(both '-' from regexp_replace(
    lower(translate(value,
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn')),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

create or replace function public.ensure_safe_product_slug()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  candidate text;
begin
  candidate := public.normalize_product_slug(
    coalesce(nullif(new.slug, ''), concat_ws('-', new."codigoInterno", new.nome))
  );
  if candidate = '' then candidate := 'produto-' || lower(new.id); end if;

  if exists (select 1 from public."Produto" p where lower(p.slug) = candidate and p.id <> new.id) then
    candidate := candidate || '-' || substring(md5(new.id), 1, 6);
  end if;
  new.slug := candidate;
  return new;
end;
$$;

drop trigger if exists "Produto_safe_slug" on public."Produto";
create trigger "Produto_safe_slug"
before insert or update of slug on public."Produto"
for each row execute function public.ensure_safe_product_slug();

-- Repair legacy URLs containing slashes, backslashes, spaces or uppercase letters.
update public."Produto"
set slug = public.normalize_product_slug(
  coalesce(nullif(slug, ''), concat_ws('-', "codigoInterno", nome))
)
where slug is null
   or slug = ''
   or slug is distinct from public.normalize_product_slug(slug);

-- Slug is routing metadata and must always be available, independently of the
-- commercial field visibility matrix.
create or replace function public.visible_product_json(p public."Produto", requested_role text)
returns jsonb language plpgsql stable security definer set search_path = public
as $function$
declare
  authenticated_role text := lower(public.current_app_role());
  role_key text; payload jsonb := '{}'::jsonb; allow_field boolean; field record;
  source jsonb := to_jsonb(p); role_permissions jsonb := public.get_current_product_permissions();
begin
  if authenticated_role in ('admin', 'admin_master', 'admin_colaborador') then
    return source || jsonb_build_object('permissoesProduto', role_permissions);
  end if;
  role_key := case when authenticated_role in ('visitante','nao_cliente','cliente','representante') then authenticated_role else 'visitante' end;
  for field in select * from public."ProductFieldPermission" loop
    allow_field := case role_key
      when 'visitante' then field."visibleToVisitor" when 'nao_cliente' then field."visibleToNonClient"
      when 'cliente' then field."visibleToClient" when 'representante' then field."visibleToRepresentative" else false end;
    if allow_field and source ? field."fieldKey" then payload := payload || jsonb_build_object(field."fieldKey", source -> field."fieldKey"); end if;
  end loop;
  return payload || jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'ativo', p.ativo, 'destaque', p.destaque, 'lancamento', p.lancamento,
    'promocao', p.promocao, 'ordem', p.ordem, 'categoriaId', p."categoriaId",
    'subcategoriaId', p."subcategoriaId", 'grupoProdutoId', p."grupoProdutoId",
    'marcaId', p."marcaId", 'imagemCard', p."imagemCard", 'imagemDetalhe', p."imagemDetalhe",
    'imagensExtras', to_jsonb(coalesce(p."imagensExtras", array[]::text[])),
    'createdAt', p."createdAt", 'updatedAt', p."updatedAt", 'permissoesProduto', role_permissions
  );
end;
$function$;

grant execute on function public.normalize_product_slug(text) to authenticated;
