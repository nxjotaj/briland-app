create table if not exists public."Montadora" (
  id text not null primary key,
  nome text not null,
  slug text not null,
  ativo boolean not null default true,
  "createdAt" timestamp without time zone not null default CURRENT_TIMESTAMP,
  "updatedAt" timestamp without time zone not null default CURRENT_TIMESTAMP
);

create table if not exists public."ModeloVeiculo" (
  id text not null primary key,
  nome text not null,
  slug text not null,
  "montadoraId" text not null references public."Montadora" (id) on update cascade on delete restrict,
  ativo boolean not null default true,
  "createdAt" timestamp without time zone not null default CURRENT_TIMESTAMP,
  "updatedAt" timestamp without time zone not null default CURRENT_TIMESTAMP
);

create table if not exists public."ProdutoModeloVeiculo" (
  id text not null primary key,
  "produtoId" text not null references public."Produto" (id) on update cascade on delete cascade,
  "montadoraId" text not null references public."Montadora" (id) on update cascade on delete restrict,
  "modeloId" text not null references public."ModeloVeiculo" (id) on update cascade on delete restrict,
  "observacaoComercial" text null,
  "createdAt" timestamp without time zone not null default CURRENT_TIMESTAMP,
  "updatedAt" timestamp without time zone not null default CURRENT_TIMESTAMP,
  constraint "ProdutoModeloVeiculo_produto_modelo_key" unique ("produtoId", "modeloId")
);

create unique index if not exists "Montadora_slug_key" on public."Montadora" using btree (slug);
create index if not exists "Montadora_nome_idx" on public."Montadora" using btree (nome);
create unique index if not exists "ModeloVeiculo_montadora_slug_key" on public."ModeloVeiculo" using btree ("montadoraId", slug);
create index if not exists "ModeloVeiculo_nome_idx" on public."ModeloVeiculo" using btree (nome);
create index if not exists "ModeloVeiculo_montadoraId_idx" on public."ModeloVeiculo" using btree ("montadoraId");
create index if not exists "ProdutoModeloVeiculo_produtoId_idx" on public."ProdutoModeloVeiculo" using btree ("produtoId");
create index if not exists "ProdutoModeloVeiculo_montadoraId_idx" on public."ProdutoModeloVeiculo" using btree ("montadoraId");
create index if not exists "ProdutoModeloVeiculo_modeloId_idx" on public."ProdutoModeloVeiculo" using btree ("modeloId");

alter table public."Montadora" enable row level security;
alter table public."ModeloVeiculo" enable row level security;
alter table public."ProdutoModeloVeiculo" enable row level security;

grant select on table public."Montadora", public."ModeloVeiculo", public."ProdutoModeloVeiculo" to anon, authenticated;
grant insert, update, delete on table public."Montadora", public."ModeloVeiculo", public."ProdutoModeloVeiculo" to authenticated;

drop policy if exists "public read active vehicle brands" on public."Montadora";
drop policy if exists "catalog insert vehicle brands" on public."Montadora";
drop policy if exists "catalog update vehicle brands" on public."Montadora";
drop policy if exists "master delete vehicle brands" on public."Montadora";
create policy "public read active vehicle brands" on public."Montadora"
for select using (ativo = true or public.can_manage_catalog());
create policy "catalog insert vehicle brands" on public."Montadora"
for insert with check (public.can_manage_catalog());
create policy "catalog update vehicle brands" on public."Montadora"
for update using (public.can_manage_catalog()) with check (public.can_manage_catalog());
create policy "master delete vehicle brands" on public."Montadora"
for delete using (public.is_admin_master());

drop policy if exists "public read active vehicle models" on public."ModeloVeiculo";
drop policy if exists "catalog insert vehicle models" on public."ModeloVeiculo";
drop policy if exists "catalog update vehicle models" on public."ModeloVeiculo";
drop policy if exists "master delete vehicle models" on public."ModeloVeiculo";
create policy "public read active vehicle models" on public."ModeloVeiculo"
for select using (ativo = true or public.can_manage_catalog());
create policy "catalog insert vehicle models" on public."ModeloVeiculo"
for insert with check (public.can_manage_catalog());
create policy "catalog update vehicle models" on public."ModeloVeiculo"
for update using (public.can_manage_catalog()) with check (public.can_manage_catalog());
create policy "master delete vehicle models" on public."ModeloVeiculo"
for delete using (public.is_admin_master());

drop policy if exists "public read active product vehicle models" on public."ProdutoModeloVeiculo";
drop policy if exists "catalog insert product vehicle models" on public."ProdutoModeloVeiculo";
drop policy if exists "catalog update product vehicle models" on public."ProdutoModeloVeiculo";
drop policy if exists "catalog delete product vehicle models" on public."ProdutoModeloVeiculo";
create policy "public read active product vehicle models" on public."ProdutoModeloVeiculo"
for select using (
  public.can_manage_catalog()
  or (
    exists (select 1 from public."Produto" p where p.id = "produtoId" and p.ativo = true)
    and exists (select 1 from public."Montadora" m where m.id = "montadoraId" and m.ativo = true)
    and exists (select 1 from public."ModeloVeiculo" mv where mv.id = "modeloId" and mv.ativo = true)
  )
);
create policy "catalog insert product vehicle models" on public."ProdutoModeloVeiculo"
for insert with check (public.can_manage_catalog());
create policy "catalog update product vehicle models" on public."ProdutoModeloVeiculo"
for update using (public.can_manage_catalog()) with check (public.can_manage_catalog());
create policy "catalog delete product vehicle models" on public."ProdutoModeloVeiculo"
for delete using (public.can_manage_catalog());

insert into public."ProductFieldPermission" (
  id, "fieldKey", "fieldLabel", "visibleToVisitor", "visibleToNonClient",
  "visibleToClient", "visibleToRepresentative", "visibleToAdmin", "updatedAt"
)
values
  ('perm_marca', 'marca', 'Marca', true, true, true, true, true, CURRENT_TIMESTAMP),
  ('perm_ca', 'ca', 'CA', false, false, true, true, true, CURRENT_TIMESTAMP),
  ('perm_manual_pdf', 'manualPdf', 'Manual PDF', false, false, true, true, true, CURRENT_TIMESTAMP),
  ('perm_botao_orcamento', 'botaoOrcamento', 'Botão solicitar orçamento', false, true, true, true, true, CURRENT_TIMESTAMP),
  ('perm_botao_whatsapp', 'botaoWhatsApp', 'Botão WhatsApp', false, true, true, true, true, CURRENT_TIMESTAMP),
  ('perm_aplicacoes_veiculo', 'aplicacoesVeiculo', 'Montadora / Modelo', true, true, true, true, true, CURRENT_TIMESTAMP)
on conflict ("fieldKey") do update set
  "fieldLabel" = excluded."fieldLabel",
  "updatedAt" = CURRENT_TIMESTAMP;

create or replace function public.product_field_allowed(field_key text, requested_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case lower(coalesce(requested_role, public.current_app_role(), 'visitante'))
    when 'admin' then true
    when 'admin_master' then true
    when 'admin_colaborador' then true
    when 'visitante' then coalesce(p."visibleToVisitor", false)
    when 'nao_cliente' then coalesce(p."visibleToNonClient", false)
    when 'cliente' then coalesce(p."visibleToClient", false)
    when 'representante' then coalesce(p."visibleToRepresentative", false)
    else false
  end
  from public."ProductFieldPermission" p
  where p."fieldKey" = field_key
  limit 1;
$$;

create or replace function public.product_role_permissions(requested_role text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(p."fieldKey",
    case lower(coalesce(requested_role, public.current_app_role(), 'visitante'))
      when 'admin' then true
      when 'admin_master' then true
      when 'admin_colaborador' then true
      when 'visitante' then p."visibleToVisitor"
      when 'nao_cliente' then p."visibleToNonClient"
      when 'cliente' then p."visibleToClient"
      when 'representante' then p."visibleToRepresentative"
      else false
    end
  ), '{}'::jsonb)
  from public."ProductFieldPermission" p;
$$;

create or replace function public.product_vehicle_applications(product_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pmv.id,
    'produtoId', pmv."produtoId",
    'montadoraId', pmv."montadoraId",
    'modeloId', pmv."modeloId",
    'observacaoComercial', pmv."observacaoComercial",
    'montadoraNome', m.nome,
    'montadoraSlug', m.slug,
    'modeloNome', mv.nome,
    'modeloSlug', mv.slug
  ) order by m.nome asc, mv.nome asc), '[]'::jsonb)
  from public."ProdutoModeloVeiculo" pmv
  join public."Montadora" m on m.id = pmv."montadoraId"
  join public."ModeloVeiculo" mv on mv.id = pmv."modeloId"
  where pmv."produtoId" = product_id
    and (public.can_manage_catalog() or (m.ativo = true and mv.ativo = true));
$$;

create or replace function public.visible_product_json(p public."Produto", requested_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  role_key text := lower(coalesce(requested_role, public.current_app_role(), 'VISITANTE'));
  payload jsonb := '{}'::jsonb;
  allow_field boolean;
  field record;
  source jsonb := to_jsonb(p);
  role_permissions jsonb := public.product_role_permissions(role_key);
begin
  if role_key in ('admin', 'admin_master', 'admin_colaborador') then
    return source
      || jsonb_build_object('aplicacoesVeiculo', public.product_vehicle_applications(p.id))
      || jsonb_build_object('permissoesProduto', role_permissions);
  end if;

  for field in
    select *
    from public."ProductFieldPermission"
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

  payload := payload
    || jsonb_build_object('id', p.id)
    || jsonb_build_object('ativo', p.ativo)
    || jsonb_build_object('destaque', p.destaque)
    || jsonb_build_object('ordem', p.ordem)
    || jsonb_build_object('categoriaId', p."categoriaId")
    || jsonb_build_object('marcaId', p."marcaId")
    || jsonb_build_object('createdAt', p."createdAt")
    || jsonb_build_object('updatedAt', p."updatedAt")
    || jsonb_build_object('permissoesProduto', role_permissions);

  if public.product_field_allowed('aplicacoesVeiculo', role_key) then
    payload := payload || jsonb_build_object('aplicacoesVeiculo', public.product_vehicle_applications(p.id));
  end if;

  return payload;
end;
$$;

drop trigger if exists "audit_Montadora_changes" on public."Montadora";
create trigger "audit_Montadora_changes"
after insert or update or delete on public."Montadora"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_ModeloVeiculo_changes" on public."ModeloVeiculo";
create trigger "audit_ModeloVeiculo_changes"
after insert or update or delete on public."ModeloVeiculo"
for each row execute function public.audit_table_change();

drop trigger if exists "audit_ProdutoModeloVeiculo_changes" on public."ProdutoModeloVeiculo";
create trigger "audit_ProdutoModeloVeiculo_changes"
after insert or update or delete on public."ProdutoModeloVeiculo"
for each row execute function public.audit_table_change();

insert into public."Montadora" (id, nome, slug, ativo)
values ('mont_audi', 'Audi', 'audi', true)
on conflict (id) do update set nome = excluded.nome, slug = excluded.slug, ativo = true, "updatedAt" = CURRENT_TIMESTAMP;

insert into public."ModeloVeiculo" (id, nome, slug, "montadoraId", ativo)
values
  ('modelo_audi_a3', 'A3', 'a3', 'mont_audi', true),
  ('modelo_audi_a4', 'A4', 'a4', 'mont_audi', true),
  ('modelo_audi_a5', 'A5', 'a5', 'mont_audi', true)
on conflict (id) do update set nome = excluded.nome, slug = excluded.slug, "montadoraId" = excluded."montadoraId", ativo = true, "updatedAt" = CURRENT_TIMESTAMP;

with ranked_products as (
  select id, row_number() over (order by ordem asc, nome asc) as rn
  from public."Produto"
  where ativo = true
  limit 2
)
insert into public."ProdutoModeloVeiculo" (id, "produtoId", "montadoraId", "modeloId", "observacaoComercial")
select
  case when rn = 1 then 'pmv_seed_audi_a3' else 'pmv_seed_audi_a5' end,
  id,
  'mont_audi',
  case when rn = 1 then 'modelo_audi_a3' else 'modelo_audi_a5' end,
  case when rn = 1
    then 'Produto indicado para reposição específica deste modelo.'
    else 'Aplicação técnica cadastrada para validação do filtro por montadora.'
  end
from ranked_products
on conflict (id) do update set
  "produtoId" = excluded."produtoId",
  "montadoraId" = excluded."montadoraId",
  "modeloId" = excluded."modeloId",
  "observacaoComercial" = excluded."observacaoComercial",
  "updatedAt" = CURRENT_TIMESTAMP;
