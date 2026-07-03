create or replace function public.get_visible_vehicle_applications()
returns table (
  id text,
  "produtoId" text,
  "montadoraId" text,
  "modeloId" text,
  "observacaoComercial" text,
  "createdAt" timestamp without time zone,
  "updatedAt" timestamp without time zone,
  "montadoraNome" text,
  "montadoraSlug" text,
  "modeloNome" text,
  "modeloSlug" text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pmv.id,
    pmv."produtoId",
    pmv."montadoraId",
    pmv."modeloId",
    pmv."observacaoComercial",
    pmv."createdAt",
    pmv."updatedAt",
    m.nome as "montadoraNome",
    m.slug as "montadoraSlug",
    mv.nome as "modeloNome",
    mv.slug as "modeloSlug"
  from public."ProdutoModeloVeiculo" pmv
  join public."Produto" p on p.id = pmv."produtoId"
  join public."Montadora" m on m.id = pmv."montadoraId"
  join public."ModeloVeiculo" mv on mv.id = pmv."modeloId"
  where p.ativo = true
    and m.ativo = true
    and mv.ativo = true
  order by m.nome asc, mv.nome asc;
$$;

grant execute on function public.get_visible_vehicle_applications() to anon, authenticated;
