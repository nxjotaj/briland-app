-- Visão administrativa consolidada do estoque físico, reservado e disponível.
create or replace function public.get_admin_stock_balances()
returns table(
  "productId" text,
  "productCode" text,
  "productName" text,
  "physicalBalance" integer,
  "reservedBalance" integer,
  "availableBalance" integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p."codigoInterno",
    p.nome,
    coalesce(p.estoque, 0)::integer,
    coalesce(sum(r.quantity) filter (where r.status = 'ACTIVE'), 0)::integer,
    (coalesce(p.estoque, 0) - coalesce(sum(r.quantity) filter (where r.status = 'ACTIVE'), 0))::integer
  from public."Produto" p
  left join public."StockReservation" r on r."productId" = p.id
  where p.ativo = true and public.can_manage_stock()
  group by p.id, p."codigoInterno", p.nome, p.estoque
  order by p.nome;
$$;

revoke all on function public.get_admin_stock_balances() from public;
grant execute on function public.get_admin_stock_balances() to authenticated;

notify pgrst, 'reload schema';
