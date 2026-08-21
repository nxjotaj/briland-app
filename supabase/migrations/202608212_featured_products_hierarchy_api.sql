create or replace function public.get_featured_products_api(p_offset integer default 0, p_limit integer default 20)
returns table(item jsonb, total bigint)
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'code', p."codigoInterno", 'name', p.nome, 'slug', p.slug,
    'imageUrl', coalesce(p."imagemCard", p."imagemPrincipal"),
    'shortDescription', p."descricaoCurta", 'description', p."descricaoCompleta", 'masterBox', p."caixaMaster",
    'category', case when c.id is null then null else jsonb_build_object('id', c.id, 'nome', c.nome, 'slug', c.slug) end,
    'subcategory', case when s.id is null then null else jsonb_build_object('id', s.id, 'nome', s.nome, 'slug', s.slug) end,
    'productGroup', case when g.id is null then null else jsonb_build_object('id', g.id, 'nome', g.nome, 'slug', g.slug) end,
    'brand', case when m.id is null then null else jsonb_build_object('id', m.id, 'nome', m.nome, 'slug', m.slug, 'logo', m.logo) end,
    'destaque', true, 'updatedAt', p."updatedAt"
  ), count(*) over()
  from public."Produto" p
  left join public."Categoria" c on c.id = p."categoriaId"
  left join public."Subcategoria" s on s.id = p."subcategoriaId"
  left join public."GrupoProduto" g on g.id = p."grupoProdutoId"
  left join public."Marca" m on m.id = p."marcaId"
  where p.ativo = true and p.destaque = true
  order by p.ordem, p.nome
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.get_featured_products_api(integer, integer) from public;
grant execute on function public.get_featured_products_api(integer, integer) to anon, authenticated;
