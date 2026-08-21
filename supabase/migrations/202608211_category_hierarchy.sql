create table if not exists public."Subcategoria" (
  id text primary key,
  "categoriaId" text not null references public."Categoria"(id) on update cascade on delete restrict,
  nome text not null,
  slug text not null,
  descricao text,
  imagem text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public."GrupoProduto" (
  id text primary key,
  "subcategoriaId" text not null references public."Subcategoria"(id) on update cascade on delete restrict,
  nome text not null,
  slug text not null,
  descricao text,
  imagem text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create unique index if not exists "Subcategoria_categoria_slug_unique"
on public."Subcategoria" ("categoriaId", lower(slug));
create unique index if not exists "Subcategoria_categoria_nome_unique"
on public."Subcategoria" ("categoriaId", lower(nome));
create unique index if not exists "GrupoProduto_subcategoria_slug_unique"
on public."GrupoProduto" ("subcategoriaId", lower(slug));
create unique index if not exists "GrupoProduto_subcategoria_nome_unique"
on public."GrupoProduto" ("subcategoriaId", lower(nome));

alter table public."Produto"
  add column if not exists "subcategoriaId" text references public."Subcategoria"(id) on update cascade on delete restrict,
  add column if not exists "grupoProdutoId" text references public."GrupoProduto"(id) on update cascade on delete restrict;

create index if not exists "Produto_subcategoriaId_idx" on public."Produto" ("subcategoriaId");
create index if not exists "Produto_grupoProdutoId_idx" on public."Produto" ("grupoProdutoId");

create or replace function public.validate_product_category_hierarchy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  sub_category_id text;
  group_subcategory_id text;
begin
  if new."categoriaId" is null or btrim(new."categoriaId") = '' then
    raise exception using message = 'Todo produto precisa ter uma categoria.';
  end if;
  if new."grupoProdutoId" is not null and new."subcategoriaId" is null then
    raise exception using message = 'Selecione uma subcategoria antes de escolher o grupo de produtos.';
  end if;
  if new."subcategoriaId" is not null then
    select "categoriaId" into sub_category_id from public."Subcategoria" where id = new."subcategoriaId";
    if sub_category_id is null or sub_category_id <> new."categoriaId" then
      raise exception using message = 'A subcategoria selecionada não pertence à categoria deste produto.';
    end if;
  end if;
  if new."grupoProdutoId" is not null then
    select "subcategoriaId" into group_subcategory_id from public."GrupoProduto" where id = new."grupoProdutoId";
    if group_subcategory_id is null or group_subcategory_id <> new."subcategoriaId" then
      raise exception using message = 'O grupo selecionado não pertence à subcategoria deste produto.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists "Produto_validate_category_hierarchy" on public."Produto";
create trigger "Produto_validate_category_hierarchy"
before insert or update of "categoriaId", "subcategoriaId", "grupoProdutoId" on public."Produto"
for each row execute function public.validate_product_category_hierarchy();

create or replace function public.validate_taxonomy_parent_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'Subcategoria' and new."categoriaId" is distinct from old."categoriaId" and exists (
    select 1 from public."Produto" where "subcategoriaId" = old.id and "categoriaId" <> new."categoriaId"
  ) then raise exception using message = 'Esta subcategoria possui produtos vinculados à categoria atual. Realocá-los antes de trocar a categoria.';
  end if;
  if tg_table_name = 'GrupoProduto' and new."subcategoriaId" is distinct from old."subcategoriaId" and exists (
    select 1 from public."Produto" where "grupoProdutoId" = old.id and "subcategoriaId" <> new."subcategoriaId"
  ) then raise exception using message = 'Este grupo possui produtos vinculados à subcategoria atual. Realocá-los antes de trocar a subcategoria.';
  end if;
  return new;
end; $$;

drop trigger if exists "Subcategoria_validate_parent_change" on public."Subcategoria";
create trigger "Subcategoria_validate_parent_change" before update of "categoriaId" on public."Subcategoria" for each row execute function public.validate_taxonomy_parent_change();
drop trigger if exists "GrupoProduto_validate_parent_change" on public."GrupoProduto";
create trigger "GrupoProduto_validate_parent_change" before update of "subcategoriaId" on public."GrupoProduto" for each row execute function public.validate_taxonomy_parent_change();

alter table public."Subcategoria" enable row level security;
alter table public."GrupoProduto" enable row level security;

drop policy if exists "public read active subcategories" on public."Subcategoria";
create policy "public read active subcategories" on public."Subcategoria"
for select to anon, authenticated using (ativo or lower(coalesce(public.current_app_role(), '')) in ('admin','admin_master','admin_colaborador'));
drop policy if exists "admin manage subcategories" on public."Subcategoria";
create policy "admin manage subcategories" on public."Subcategoria"
for all to authenticated using (lower(coalesce(public.current_app_role(), '')) in ('admin','admin_master','admin_colaborador'))
with check (lower(coalesce(public.current_app_role(), '')) in ('admin','admin_master','admin_colaborador'));

drop policy if exists "public read active product groups" on public."GrupoProduto";
create policy "public read active product groups" on public."GrupoProduto"
for select to anon, authenticated using (ativo or lower(coalesce(public.current_app_role(), '')) in ('admin','admin_master','admin_colaborador'));
drop policy if exists "admin manage product groups" on public."GrupoProduto";
create policy "admin manage product groups" on public."GrupoProduto"
for all to authenticated using (lower(coalesce(public.current_app_role(), '')) in ('admin','admin_master','admin_colaborador'))
with check (lower(coalesce(public.current_app_role(), '')) in ('admin','admin_master','admin_colaborador'));

grant select on public."Subcategoria", public."GrupoProduto" to anon, authenticated;
grant insert, update, delete on public."Subcategoria", public."GrupoProduto" to authenticated;

drop trigger if exists "audit_Subcategoria_changes" on public."Subcategoria";
create trigger "audit_Subcategoria_changes" after insert or update or delete on public."Subcategoria"
for each row execute function public.audit_table_change();
drop trigger if exists "audit_GrupoProduto_changes" on public."GrupoProduto";
create trigger "audit_GrupoProduto_changes" after insert or update or delete on public."GrupoProduto"
for each row execute function public.audit_table_change();

drop trigger if exists "catalog_revision_Subcategoria" on public."Subcategoria";
create trigger "catalog_revision_Subcategoria" after insert or update or delete on public."Subcategoria"
for each statement execute function public.bump_catalog_revision('CATALOGO');
drop trigger if exists "catalog_revision_GrupoProduto" on public."GrupoProduto";
create trigger "catalog_revision_GrupoProduto" after insert or update or delete on public."GrupoProduto"
for each statement execute function public.bump_catalog_revision('CATALOGO');

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='Subcategoria') then
      alter publication supabase_realtime add table public."Subcategoria";
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='GrupoProduto') then
      alter publication supabase_realtime add table public."GrupoProduto";
    end if;
  end if;
end $$;

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
    'id', p.id, 'ativo', p.ativo, 'destaque', p.destaque, 'lancamento', p.lancamento,
    'promocao', p.promocao, 'ordem', p.ordem, 'categoriaId', p."categoriaId",
    'subcategoriaId', p."subcategoriaId", 'grupoProdutoId', p."grupoProdutoId",
    'marcaId', p."marcaId", 'imagemCard', p."imagemCard", 'imagemDetalhe', p."imagemDetalhe",
    'imagensExtras', to_jsonb(coalesce(p."imagensExtras", array[]::text[])),
    'createdAt', p."createdAt", 'updatedAt', p."updatedAt", 'permissoesProduto', role_permissions
  );
end;
$function$;
