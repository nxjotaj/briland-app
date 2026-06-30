begin;

create extension if not exists pgcrypto;

alter table public."User"
  add column if not exists "authUserId" uuid unique references auth.users(id) on delete set null;

create table if not exists public."AppSetting" (
  id text primary key default gen_random_uuid()::text,
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  "createdAt" timestamp without time zone not null default now(),
  "updatedAt" timestamp without time zone not null default now()
);

insert into public."AppSetting" (key, value)
values
  ('media', jsonb_build_object(
    'initialImage', '',
    'homeImage', '',
    'recommendations', jsonb_build_object(
      'initialImage', '1080 x 1440 px, JPG/PNG/WEBP ate 5MB',
      'homeImage', '1200 x 760 px, JPG/PNG/WEBP ate 5MB',
      'categoryImage', '900 x 700 px',
      'brandLogo', '600 x 300 px'
    )
  )),
  ('socialLinks', jsonb_build_object(
    'instagram', 'https://instagram.com/briland',
    'linkedin', 'https://linkedin.com/company/briland',
    'whatsapp', 'https://wa.me/5521973636891',
    'site', 'https://briland.com.br'
  )),
  ('contact', jsonb_build_object(
    'whatsappNumber', '5521973636891'
  ))
on conflict (key) do nothing;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

drop trigger if exists "AppSetting_touch_updatedAt" on public."AppSetting";
create trigger "AppSetting_touch_updatedAt"
before update on public."AppSetting"
for each row execute function public.touch_updated_at();

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select u.role::text
      from public."User" u
      where u."authUserId" = auth.uid()
        and u.status = 'ACTIVE'
      limit 1
    ),
    'VISITANTE'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'ADMIN';
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
  if role_key = 'admin' then
    return source;
  end if;

  for field in
    select *
    from public."ProductFieldPermission"
  loop
    allow_field := case role_key
      when 'visitante' then field."visibleToVisitor"
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
  where p.ativo = true or public.current_app_role() = 'ADMIN'
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
    and (p.ativo = true or public.current_app_role() = 'ADMIN')
  limit 1;
$$;

create or replace function public.get_app_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public."AppSetting";
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
  if not public.is_admin() then
    raise exception 'Only ADMIN can update app settings';
  end if;

  insert into public."AppSetting" (key, value)
  values (setting_key, setting_value)
  on conflict (key) do update set value = excluded.value, "updatedAt" = now()
  returning * into row_out;

  return row_out;
end;
$$;

alter table public."Produto" enable row level security;
alter table public."Categoria" enable row level security;
alter table public."Marca" enable row level security;
alter table public."Aplicacao" enable row level security;
alter table public."ProdutoAplicacao" enable row level security;
alter table public."LeadOrcamento" enable row level security;
alter table public."ProductFieldPermission" enable row level security;
alter table public."User" enable row level security;
alter table public."AuditLog" enable row level security;
alter table public."SecurityRateLimit" enable row level security;
alter table public."AppSetting" enable row level security;

drop policy if exists "public read active categories" on public."Categoria";
create policy "public read active categories" on public."Categoria"
for select using (ativo = true or public.is_admin());

drop policy if exists "admin write categories" on public."Categoria";
create policy "admin write categories" on public."Categoria"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read active brands" on public."Marca";
create policy "public read active brands" on public."Marca"
for select using (ativo = true or public.is_admin());

drop policy if exists "admin write brands" on public."Marca";
create policy "admin write brands" on public."Marca"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read active applications" on public."Aplicacao";
create policy "public read active applications" on public."Aplicacao"
for select using (ativo = true or public.is_admin());

drop policy if exists "admin write applications" on public."Aplicacao";
create policy "admin write applications" on public."Aplicacao"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin read products" on public."Produto";
create policy "admin read products" on public."Produto"
for select using (public.is_admin());

drop policy if exists "admin write products" on public."Produto";
create policy "admin write products" on public."Produto"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin product applications" on public."ProdutoAplicacao";
create policy "admin product applications" on public."ProdutoAplicacao"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public create leads" on public."LeadOrcamento";
create policy "public create leads" on public."LeadOrcamento"
for insert with check (true);

drop policy if exists "admin manage leads" on public."LeadOrcamento";
create policy "admin manage leads" on public."LeadOrcamento"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage permissions" on public."ProductFieldPermission";
create policy "admin manage permissions" on public."ProductFieldPermission"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "user reads self" on public."User";
create policy "user reads self" on public."User"
for select using ("authUserId" = auth.uid());

drop policy if exists "admin manage users" on public."User";
create policy "admin manage users" on public."User"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin read audit" on public."AuditLog";
create policy "admin read audit" on public."AuditLog"
for select using (public.is_admin());

drop policy if exists "admin manage app settings" on public."AppSetting";
create policy "admin manage app settings" on public."AppSetting"
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read app settings" on public."AppSetting";
create policy "public read app settings" on public."AppSetting"
for select using (true);

commit;
