-- Representantes recebem somente o saldo disponível. Físico e reservado permanecem privados dos administradores.
create or replace function public.get_sales_stock()
returns table("productId" text,"productCode" text,"productName" text,"physicalBalance" integer,"reservedBalance" integer,"availableBalance" integer,"listPrice" numeric)
language sql stable security definer set search_path=public
as $$
  with actor as (
    select public.current_app_role() as role
  ), balances as (
    select
      p.id,
      p."codigoInterno",
      p.nome,
      coalesce(p.estoque,0)::integer as physical,
      coalesce(sum(r.quantity) filter(where r.status='ACTIVE'),0)::integer as reserved,
      p.preco
    from public."Produto" p
    left join public."StockReservation" r on r."productId"=p.id
    where p.ativo=true
    group by p.id,p."codigoInterno",p.nome,p.estoque,p.preco
  )
  select
    b.id,
    b."codigoInterno",
    b.nome,
    case when actor.role='REPRESENTANTE' then b.physical-b.reserved else b.physical end,
    case when actor.role='REPRESENTANTE' then 0 else b.reserved end,
    b.physical-b.reserved,
    b.preco
  from balances b
  cross join actor
  where actor.role='REPRESENTANTE' or public.is_sales_admin()
  order by b.nome;
$$;

