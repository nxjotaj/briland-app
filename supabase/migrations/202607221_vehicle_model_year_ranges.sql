alter table public."ModeloVeiculo"
  add column if not exists "anoInicial" integer null,
  add column if not exists "anoFinal" integer null;

alter table public."ProdutoModeloVeiculo"
  add column if not exists "anoInicial" integer null,
  add column if not exists "anoFinal" integer null;

alter table public."ModeloVeiculo" drop constraint if exists "ModeloVeiculo_anos_validos";
alter table public."ModeloVeiculo" add constraint "ModeloVeiculo_anos_validos" check (
  ("anoInicial" is null and "anoFinal" is null)
  or ("anoInicial" between 1950 and 2200 and "anoFinal" between "anoInicial" and 2200)
);

alter table public."ProdutoModeloVeiculo" drop constraint if exists "ProdutoModeloVeiculo_anos_validos";
alter table public."ProdutoModeloVeiculo" add constraint "ProdutoModeloVeiculo_anos_validos" check (
  ("anoInicial" is null and "anoFinal" is null)
  or ("anoInicial" between 1950 and 2200 and "anoFinal" between "anoInicial" and 2200)
);

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
    'anoInicial', pmv."anoInicial",
    'anoFinal', pmv."anoFinal",
    'observacaoComercial', pmv."observacaoComercial",
    'montadoraNome', m.nome,
    'montadoraSlug', m.slug,
    'modeloNome', mv.nome,
    'modeloSlug', mv.slug,
    'modeloAnoInicial', mv."anoInicial",
    'modeloAnoFinal', mv."anoFinal"
  ) order by m.nome asc, mv.nome asc, pmv."anoInicial" asc nulls first), '[]'::jsonb)
  from public."ProdutoModeloVeiculo" pmv
  join public."Montadora" m on m.id = pmv."montadoraId"
  join public."ModeloVeiculo" mv on mv.id = pmv."modeloId"
  where pmv."produtoId" = product_id
    and (public.can_manage_catalog() or (m.ativo = true and mv.ativo = true));
$$;

drop function if exists public.get_visible_vehicle_applications();
create function public.get_visible_vehicle_applications()
returns table (
  id text,
  "produtoId" text,
  "montadoraId" text,
  "modeloId" text,
  "anoInicial" integer,
  "anoFinal" integer,
  "observacaoComercial" text,
  "createdAt" timestamp without time zone,
  "updatedAt" timestamp without time zone,
  "montadoraNome" text,
  "montadoraSlug" text,
  "modeloNome" text,
  "modeloSlug" text,
  "modeloAnoInicial" integer,
  "modeloAnoFinal" integer
)
language sql
stable
security definer
set search_path = public
as $$
  select pmv.id, pmv."produtoId", pmv."montadoraId", pmv."modeloId",
    pmv."anoInicial", pmv."anoFinal", pmv."observacaoComercial", pmv."createdAt", pmv."updatedAt",
    m.nome, m.slug, mv.nome, mv.slug, mv."anoInicial", mv."anoFinal"
  from public."ProdutoModeloVeiculo" pmv
  join public."Produto" p on p.id = pmv."produtoId"
  join public."Montadora" m on m.id = pmv."montadoraId"
  join public."ModeloVeiculo" mv on mv.id = pmv."modeloId"
  where p.ativo = true and m.ativo = true and mv.ativo = true
  order by m.nome asc, mv.nome asc, pmv."anoInicial" asc nulls first;
$$;

grant execute on function public.get_visible_vehicle_applications() to anon, authenticated;

comment on column public."ModeloVeiculo"."anoInicial" is 'Primeiro ano-modelo desta geração; lista dinâmica inicia em 1950.';
comment on column public."ModeloVeiculo"."anoFinal" is 'Último ano-modelo desta geração; interface permite até o ano atual mais um.';
comment on column public."ProdutoModeloVeiculo"."anoInicial" is 'Início da compatibilidade do produto; nulo significa todos os anos do modelo.';
comment on column public."ProdutoModeloVeiculo"."anoFinal" is 'Fim da compatibilidade do produto; nulo significa todos os anos do modelo.';
