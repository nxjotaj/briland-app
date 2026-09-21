begin;

create table if not exists public."VideoRenderJob" (
  id text primary key default gen_random_uuid()::text,
  "createdBy" text not null references public."User"(id) on delete restrict,
  "productId" text not null references public."Produto"(id) on delete restrict,
  "templateKey" text not null check ("templateKey" in ('product-spotlight', 'commercial-offer', 'new-arrival')),
  format text not null check (format in ('vertical', 'square')),
  "durationSeconds" integer not null check ("durationSeconds" in (10, 15, 30)),
  headline text not null check (char_length(headline) <= 100),
  subheadline text check (char_length(coalesce(subheadline, '')) <= 180),
  cta text check (char_length(coalesce(cta, '')) <= 80),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'PREPARING', 'RENDERING', 'UPLOADING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  progress integer not null default 0 check (progress between 0 and 100),
  "inputPayload" jsonb not null default '{}'::jsonb,
  "outputStorageKey" text,
  "errorMessage" text,
  "workerId" text,
  "createdAt" timestamptz not null default now(),
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "updatedAt" timestamptz not null default now()
);

create index if not exists "VideoRenderJob_status_createdAt_idx"
on public."VideoRenderJob" (status, "createdAt");

alter table public."VideoRenderJob" enable row level security;

drop policy if exists "video jobs master read" on public."VideoRenderJob";
create policy "video jobs master read"
on public."VideoRenderJob" for select to authenticated
using (public.is_admin_master());

create or replace function public.create_video_render_job(
  p_product_id text,
  p_template_key text,
  p_format text,
  p_duration_seconds integer,
  p_headline text,
  p_subheadline text default '',
  p_cta text default ''
)
returns public."VideoRenderJob"
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public."User";
  product_row public."Produto";
  job public."VideoRenderJob";
begin
  select * into actor from public.current_app_user();
  if actor.id is null or actor.role::text not in ('ADMIN', 'ADMIN_MASTER') then
    raise exception 'Somente o administrador master pode gerar vídeos.';
  end if;

  if p_template_key not in ('product-spotlight', 'commercial-offer', 'new-arrival') then
    raise exception 'Template de vídeo inválido.';
  end if;
  if p_format not in ('vertical', 'square') then
    raise exception 'Formato de vídeo inválido.';
  end if;
  if p_duration_seconds not in (10, 15, 30) then
    raise exception 'Duração de vídeo inválida.';
  end if;
  if char_length(btrim(coalesce(p_headline, ''))) > 100 then
    raise exception 'O título deve ter no máximo 100 caracteres.';
  end if;

  select * into product_row from public."Produto" where id = p_product_id;
  if product_row.id is null then raise exception 'Produto não encontrado.'; end if;

  insert into public."VideoRenderJob" (
    "createdBy", "productId", "templateKey", format, "durationSeconds",
    headline, subheadline, cta, "inputPayload"
  ) values (
    actor.id, product_row.id, p_template_key, p_format, p_duration_seconds,
    btrim(coalesce(p_headline, '')), nullif(btrim(coalesce(p_subheadline, '')), ''),
    nullif(btrim(coalesce(p_cta, '')), ''),
    jsonb_build_object(
      'product', jsonb_build_object(
        'id', product_row.id,
        'name', product_row.nome,
        'code', product_row."codigoInterno",
        'price', product_row.preco,
        'shortDescription', product_row."descricaoCurta",
        'imageUrl', coalesce(product_row."imagemDetalhe", product_row."imagemPrincipal", product_row."imagemOriginal")
      )
    )
  ) returning * into job;

  return job;
end;
$$;

create or replace function public.cancel_video_render_job(p_job_id text)
returns public."VideoRenderJob"
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public."User";
  job public."VideoRenderJob";
begin
  select * into actor from public.current_app_user();
  if actor.id is null or actor.role::text not in ('ADMIN', 'ADMIN_MASTER') then
    raise exception 'Somente o administrador master pode cancelar vídeos.';
  end if;

  update public."VideoRenderJob"
  set status = 'CANCELLED', "finishedAt" = now(), "updatedAt" = now()
  where id = p_job_id and status = 'QUEUED'
  returning * into job;

  if job.id is null then raise exception 'O vídeo não está mais aguardando na fila.'; end if;
  return job;
end;
$$;

revoke all on function public.create_video_render_job(text, text, text, integer, text, text, text) from public;
grant execute on function public.create_video_render_job(text, text, text, integer, text, text, text) to authenticated;
revoke all on function public.cancel_video_render_job(text) from public;
grant execute on function public.cancel_video_render_job(text) to authenticated;

create or replace function public.claim_next_video_render_job(p_worker_id text)
returns setof public."VideoRenderJob"
language plpgsql
security definer
set search_path = public
as $$
declare
  next_id text;
begin
  update public."VideoRenderJob"
  set status = 'QUEUED', progress = 0, "workerId" = null, "startedAt" = null,
      "updatedAt" = now(), "errorMessage" = 'Renderização retomada após interrupção do worker.'
  where status in ('PREPARING', 'RENDERING', 'UPLOADING')
    and "updatedAt" < now() - interval '2 hours';

  select id into next_id
  from public."VideoRenderJob"
  where status = 'QUEUED'
  order by "createdAt"
  for update skip locked
  limit 1;

  if next_id is null then return; end if;

  return query
  update public."VideoRenderJob"
  set status = 'PREPARING', progress = 5, "workerId" = left(p_worker_id, 120),
      "startedAt" = now(), "updatedAt" = now(), "errorMessage" = null
  where id = next_id
  returning *;
end;
$$;

revoke all on function public.claim_next_video_render_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_video_render_job(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-videos', 'marketing-videos', false, 314572800, array['video/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "video files master read" on storage.objects;
create policy "video files master read"
on storage.objects for select to authenticated
using (bucket_id = 'marketing-videos' and public.is_admin_master());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'VideoRenderJob'
     ) then
    alter publication supabase_realtime add table public."VideoRenderJob";
  end if;
end $$;

commit;
