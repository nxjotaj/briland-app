update public."User"
set role = 'ADMIN_MASTER'::public."UserRole"
where role = 'ADMIN'::public."UserRole";

alter table public."ProductFieldPermission"
  add column if not exists "visibleToNonClient" boolean not null default false;

create table if not exists public."AppTelemetryEvent" (
  id text primary key,
  "eventType" text not null,
  screen text null,
  route text null,
  "userId" text null,
  "userRole" text null,
  "durationMs" integer null,
  success boolean null,
  message text null,
  metadata jsonb null,
  "createdAt" timestamp without time zone not null default now()
);

create index if not exists "AppTelemetryEvent_eventType_createdAt_idx"
on public."AppTelemetryEvent" using btree ("eventType", "createdAt");

create index if not exists "AppTelemetryEvent_screen_createdAt_idx"
on public."AppTelemetryEvent" using btree (screen, "createdAt");

create index if not exists "AppTelemetryEvent_userRole_createdAt_idx"
on public."AppTelemetryEvent" using btree ("userRole", "createdAt");

alter table public."AppTelemetryEvent" enable row level security;
alter table public."AuditLog" enable row level security;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when u.role::text = 'ADMIN' then 'ADMIN_MASTER'
        else u.role::text
      end
      from public."User" u
      where u."authUserId" = auth.uid()
        and u.status = 'ACTIVE'
      limit 1
    ),
    'VISITANTE'
  );
$$;

create or replace function public.is_admin_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('ADMIN_MASTER', 'ADMIN');
$$;

create or replace function public.is_admin_collaborator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'ADMIN_COLABORADOR';
$$;

create or replace function public.can_manage_catalog()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_master() or public.is_admin_collaborator();
$$;

create or replace function public.can_read_leads()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_master() or public.is_admin_collaborator();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_catalog();
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
begin
  if role_key in ('admin', 'admin_master', 'admin_colaborador') then
    return source;
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
    || jsonb_build_object('updatedAt', p."updatedAt");

  return payload;
end;
$$;

create or replace function public.get_visible_products(requested_role text default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.visible_product_json(p, coalesce(requested_role, public.current_app_role()))
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
  select public.visible_product_json(p, coalesce(requested_role, public.current_app_role()))
  from public."Produto" p
  where p.id = product_id
    and (p.ativo = true or public.can_manage_catalog())
  limit 1;
$$;

create or replace function public.save_app_setting(setting_key text, setting_value jsonb)
returns public."AppSetting"
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public."AppSetting";
begin
  if not public.is_admin_master() then
    raise exception 'Only ADMIN_MASTER can update app settings';
  end if;

  insert into public."AppSetting" (key, value)
  values (setting_key, setting_value)
  on conflict (key) do update set value = excluded.value, "updatedAt" = now()
  returning * into row_out;

  return row_out;
end;
$$;

drop policy if exists "public read active categories" on public."Categoria";
create policy "public read active categories" on public."Categoria"
for select using (ativo = true or public.can_manage_catalog());

drop policy if exists "admin write categories" on public."Categoria";
drop policy if exists "catalog insert categories" on public."Categoria";
drop policy if exists "catalog update categories" on public."Categoria";
drop policy if exists "master delete categories" on public."Categoria";
create policy "catalog insert categories" on public."Categoria"
for insert with check (public.can_manage_catalog());
create policy "catalog update categories" on public."Categoria"
for update using (public.can_manage_catalog()) with check (public.can_manage_catalog());
create policy "master delete categories" on public."Categoria"
for delete using (public.is_admin_master());

drop policy if exists "public read active brands" on public."Marca";
create policy "public read active brands" on public."Marca"
for select using (ativo = true or public.can_manage_catalog());

drop policy if exists "admin write brands" on public."Marca";
drop policy if exists "catalog insert brands" on public."Marca";
drop policy if exists "catalog update brands" on public."Marca";
drop policy if exists "master delete brands" on public."Marca";
create policy "catalog insert brands" on public."Marca"
for insert with check (public.can_manage_catalog());
create policy "catalog update brands" on public."Marca"
for update using (public.can_manage_catalog()) with check (public.can_manage_catalog());
create policy "master delete brands" on public."Marca"
for delete using (public.is_admin_master());

drop policy if exists "public read active applications" on public."Aplicacao";
create policy "public read active applications" on public."Aplicacao"
for select using (ativo = true or public.can_manage_catalog());

drop policy if exists "admin write applications" on public."Aplicacao";
drop policy if exists "catalog insert applications" on public."Aplicacao";
drop policy if exists "catalog update applications" on public."Aplicacao";
drop policy if exists "master delete applications" on public."Aplicacao";
create policy "catalog insert applications" on public."Aplicacao"
for insert with check (public.can_manage_catalog());
create policy "catalog update applications" on public."Aplicacao"
for update using (public.can_manage_catalog()) with check (public.can_manage_catalog());
create policy "master delete applications" on public."Aplicacao"
for delete using (public.is_admin_master());

drop policy if exists "admin read products" on public."Produto";
drop policy if exists "admin write products" on public."Produto";
drop policy if exists "catalog read products" on public."Produto";
drop policy if exists "catalog insert products" on public."Produto";
drop policy if exists "catalog update products" on public."Produto";
drop policy if exists "catalog delete products" on public."Produto";
create policy "catalog read products" on public."Produto"
for select using (public.can_manage_catalog());
create policy "catalog insert products" on public."Produto"
for insert with check (public.can_manage_catalog());
create policy "catalog update products" on public."Produto"
for update using (public.can_manage_catalog()) with check (public.can_manage_catalog());
create policy "catalog delete products" on public."Produto"
for delete using (public.can_manage_catalog());

drop policy if exists "admin product applications" on public."ProdutoAplicacao";
create policy "admin product applications" on public."ProdutoAplicacao"
for all using (public.can_manage_catalog()) with check (public.can_manage_catalog());

drop policy if exists "admin manage leads" on public."LeadOrcamento";
drop policy if exists "admin read leads" on public."LeadOrcamento";
drop policy if exists "admin update leads" on public."LeadOrcamento";
drop policy if exists "master delete leads" on public."LeadOrcamento";
create policy "admin read leads" on public."LeadOrcamento"
for select using (public.can_read_leads());
create policy "admin update leads" on public."LeadOrcamento"
for update using (public.can_read_leads()) with check (public.can_read_leads());
create policy "master delete leads" on public."LeadOrcamento"
for delete using (public.is_admin_master());

drop policy if exists "admin manage permissions" on public."ProductFieldPermission";
create policy "admin manage permissions" on public."ProductFieldPermission"
for all using (public.is_admin_master()) with check (public.is_admin_master());

drop policy if exists "admin manage users" on public."User";
create policy "admin manage users" on public."User"
for all using (public.is_admin_master()) with check (public.is_admin_master());

drop policy if exists "admin manage app settings" on public."AppSetting";
create policy "admin manage app settings" on public."AppSetting"
for all using (public.is_admin_master()) with check (public.is_admin_master());

drop policy if exists "admin read audit" on public."AuditLog";
drop policy if exists "admin insert audit" on public."AuditLog";
create policy "admin read audit" on public."AuditLog"
for select using (public.is_admin_master());
create policy "admin insert audit" on public."AuditLog"
for insert to authenticated with check (public.can_manage_catalog());

drop policy if exists "telemetry public insert" on public."AppTelemetryEvent";
drop policy if exists "telemetry master read" on public."AppTelemetryEvent";
create policy "telemetry public insert" on public."AppTelemetryEvent"
for insert to anon, authenticated with check (true);
create policy "telemetry master read" on public."AppTelemetryEvent"
for select using (public.is_admin_master());

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    drop policy if exists "catalog_media_admin_insert" on storage.objects;
    drop policy if exists "catalog_media_admin_update" on storage.objects;
    drop policy if exists "catalog_media_admin_delete" on storage.objects;
    drop policy if exists "catalog_media_catalog_insert" on storage.objects;
    drop policy if exists "catalog_media_catalog_update" on storage.objects;
    drop policy if exists "catalog_media_catalog_delete" on storage.objects;

    create policy "catalog_media_catalog_insert"
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'catalog-media'
      and (
        public.is_admin_master()
        or (public.is_admin_collaborator() and name !~ '^app/')
      )
    );

    create policy "catalog_media_catalog_update"
    on storage.objects
    for update
    to authenticated
    using (
      bucket_id = 'catalog-media'
      and (
        public.is_admin_master()
        or (public.is_admin_collaborator() and name !~ '^app/')
      )
    )
    with check (
      bucket_id = 'catalog-media'
      and (
        public.is_admin_master()
        or (public.is_admin_collaborator() and name !~ '^app/')
      )
    );

    create policy "catalog_media_catalog_delete"
    on storage.objects
    for delete
    to authenticated
    using (
      bucket_id = 'catalog-media'
      and (
        public.is_admin_master()
        or (public.is_admin_collaborator() and name !~ '^app/')
      )
    );
  end if;
end $$;
