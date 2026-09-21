begin;

alter table public."VideoRenderJob"
  add column if not exists "generationMode" text not null default 'catalog'
    check ("generationMode" in ('catalog', 'ai')),
  add column if not exists "aiModel" text,
  add column if not exists prompt text,
  add column if not exists "generationSettings" jsonb,
  add column if not exists "providerRequestId" text,
  add column if not exists "sourceStorageKey" text;

create or replace function public.create_ai_video_render_job(
  p_product_id text,
  p_template_key text,
  p_format text,
  p_duration_seconds integer,
  p_headline text,
  p_subheadline text default '',
  p_cta text default '',
  p_ai_model text default 'kling-3-turbo',
  p_prompt text default '',
  p_resolution text default '1080p',
  p_generate_audio boolean default true
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
  allowed_models constant text[] := array['kling-3-turbo','kling-3-pro','seedance-2-fast','seedance-2.5','wan-2.7','minimax-hailuo-2.3'];
begin
  select * into actor from public.current_app_user();
  if actor.id is null or actor.role::text not in ('ADMIN', 'ADMIN_MASTER') then raise exception 'Somente o administrador master pode gerar vídeos.'; end if;
  if p_ai_model <> all(allowed_models) then raise exception 'Modelo de IA inválido.'; end if;
  if p_template_key not in ('product-spotlight','commercial-offer','new-arrival') then raise exception 'Template inválido.'; end if;
  if p_format not in ('vertical','square') then raise exception 'Formato inválido.'; end if;
  if p_duration_seconds not in (10,15,30) then raise exception 'Duração inválida.'; end if;
  if char_length(btrim(coalesce(p_prompt,''))) not between 10 and 1200 then raise exception 'O prompt deve ter entre 10 e 1200 caracteres.'; end if;
  if p_resolution not in ('720p','1080p') then raise exception 'Resolução inválida.'; end if;

  select * into product_row from public."Produto" where id = p_product_id;
  if product_row.id is null then raise exception 'Produto não encontrado.'; end if;

  insert into public."VideoRenderJob" (
    "createdBy","productId","templateKey",format,"durationSeconds",headline,subheadline,cta,
    "generationMode","aiModel",prompt,"generationSettings","inputPayload"
  ) values (
    actor.id,product_row.id,p_template_key,p_format,p_duration_seconds,btrim(coalesce(p_headline,'')),
    nullif(btrim(coalesce(p_subheadline,'')),''),nullif(btrim(coalesce(p_cta,'')),''),
    'ai',p_ai_model,btrim(p_prompt),jsonb_build_object('resolution',p_resolution,'generateAudio',p_generate_audio),
    jsonb_build_object(
      'product',jsonb_build_object('id',product_row.id,'name',product_row.nome,'code',product_row."codigoInterno",'price',product_row.preco,'shortDescription',product_row."descricaoCurta",'imageUrl',coalesce(product_row."imagemDetalhe",product_row."imagemPrincipal",product_row."imagemOriginal")),
      'ai',jsonb_build_object('model',p_ai_model,'prompt',btrim(p_prompt),'resolution',p_resolution,'generateAudio',p_generate_audio)
    )
  ) returning * into job;
  return job;
end;
$$;

revoke all on function public.create_ai_video_render_job(text,text,text,integer,text,text,text,text,text,text,boolean) from public;
grant execute on function public.create_ai_video_render_job(text,text,text,integer,text,text,text,text,text,text,boolean) to authenticated;

commit;
