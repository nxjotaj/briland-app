create table if not exists public."CatalogRevision" (
  id smallint primary key default 1 check (id = 1),
  revision bigint not null default 1,
  "changeKind" text not null default 'CATALOGO' check ("changeKind" in ('CATALOGO', 'SEGURANCA')),
  "updatedAt" timestamptz not null default now()
);

insert into public."CatalogRevision" (id, revision, "changeKind")
values (1, 1, 'CATALOGO')
on conflict (id) do nothing;

alter table public."CatalogRevision" enable row level security;

drop policy if exists "catalog revision is publicly readable" on public."CatalogRevision";
create policy "catalog revision is publicly readable"
on public."CatalogRevision" for select
to anon, authenticated
using (true);

create or replace function public.bump_catalog_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public."CatalogRevision" (id, revision, "changeKind", "updatedAt")
  values (1, 1, coalesce(nullif(tg_argv[0], ''), 'CATALOGO'), now())
  on conflict (id) do update
  set revision = public."CatalogRevision".revision + 1,
      "changeKind" = excluded."changeKind",
      "updatedAt" = excluded."updatedAt";
  return coalesce(new, old);
end;
$$;

do $$
declare
  catalog_table text;
begin
  foreach catalog_table in array array[
    'Produto', 'Categoria', 'Marca', 'Aplicacao', 'Montadora',
    'ModeloVeiculo', 'ProdutoModeloVeiculo', 'ProdutoAplicacao', 'AppSetting'
  ] loop
    if to_regclass(format('public.%I', catalog_table)) is not null then
      execute format('drop trigger if exists %I on public.%I', 'catalog_revision_' || catalog_table, catalog_table);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each statement execute function public.bump_catalog_revision(%L)',
        'catalog_revision_' || catalog_table, catalog_table, 'CATALOGO'
      );
    end if;
  end loop;

  if to_regclass('public."ProductFieldPermission"') is not null then
    drop trigger if exists "catalog_revision_ProductFieldPermission" on public."ProductFieldPermission";
    create trigger "catalog_revision_ProductFieldPermission"
    after insert or update or delete on public."ProductFieldPermission"
    for each statement execute function public.bump_catalog_revision('SEGURANCA');
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'CatalogRevision'
     ) then
    alter publication supabase_realtime add table public."CatalogRevision";
  end if;
end;
$$;

grant select on public."CatalogRevision" to anon, authenticated;
revoke insert, update, delete on public."CatalogRevision" from anon, authenticated;

