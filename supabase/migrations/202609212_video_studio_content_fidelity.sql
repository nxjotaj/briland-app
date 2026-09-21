begin;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public."VideoRenderJob"'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%char_length(headline)%';

  if constraint_name is not null then
    execute format('alter table public."VideoRenderJob" drop constraint %I', constraint_name);
  end if;
end $$;

alter table public."VideoRenderJob"
  add constraint "VideoRenderJob_headline_length_check"
  check (char_length(headline) <= 100);

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

revoke all on function public.create_video_render_job(text, text, text, integer, text, text, text) from public;
grant execute on function public.create_video_render_job(text, text, text, integer, text, text, text) to authenticated;

commit;
