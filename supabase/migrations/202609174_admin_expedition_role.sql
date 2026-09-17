-- Perfil administrativo restrito à operação de estoque e consulta de produtos.
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public."UserRole"'::regtype
      and enumlabel = 'ADMIN_EXPEDICAO'
  ) then
    alter type public."UserRole" add value 'ADMIN_EXPEDICAO';
  end if;
end $$;

create or replace function public.is_admin_expedition()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'ADMIN_EXPEDICAO';
$$;

create or replace function public.can_manage_stock()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_catalog() or public.is_admin_expedition();
$$;

-- Consulta integral necessária para localizar itens e conferir saldo, sem
-- conceder INSERT, UPDATE ou DELETE no cadastro de produtos.
drop policy if exists "expedition read products" on public."Produto";
create policy "expedition read products" on public."Produto"
for select to authenticated using (public.is_admin_expedition());

drop policy if exists "expedition read product applications" on public."ProdutoAplicacao";
create policy "expedition read product applications" on public."ProdutoAplicacao"
for select to authenticated using (public.is_admin_expedition());

drop policy if exists "expedition read product vehicle models" on public."ProdutoModeloVeiculo";
create policy "expedition read product vehicle models" on public."ProdutoModeloVeiculo"
for select to authenticated using (public.is_admin_expedition());

-- O perfil Expedição pode operar somente as estruturas próprias de estoque.
do $$
declare table_name text;
begin
  foreach table_name in array array['StockBatch','StockFiscalDocument','StockFiscalItem','StockMovement'] loop
    execute format('drop policy if exists "admins manage %s" on public.%I', lower(table_name), table_name);
    execute format('create policy "admins manage %s" on public.%I for all to authenticated using (public.can_manage_stock()) with check (public.can_manage_stock())', lower(table_name), table_name);
  end loop;
end $$;

drop policy if exists "admins manage stock reservation reviews" on public."StockReservationReview";
create policy "admins manage stock reservation reviews"
on public."StockReservationReview" for all to authenticated
using (public.can_manage_stock()) with check (public.can_manage_stock());

drop policy if exists "admins manage fiscal xml" on storage.objects;
create policy "admins manage fiscal xml"
on storage.objects for all to authenticated
using (bucket_id='fiscal-xml' and public.can_manage_stock())
with check (bucket_id='fiscal-xml' and public.can_manage_stock());

-- Mantém as validações transacionais existentes, trocando somente o guardião
-- de catálogo pelo guardião específico de estoque.
do $$
declare
  signature text;
  target regprocedure;
  definition text;
begin
  foreach signature in array array[
    'public.apply_manual_stock_batch(text,jsonb)',
    'public.apply_fiscal_stock_batch(text,text,jsonb)',
    'public.apply_fiscal_stock_batch_invoice_v1(text,text,jsonb)',
    'public.get_stock_maintenance_history(timestamp with time zone,timestamp with time zone,text,text,text)',
    'public.get_expired_fiscal_xml_paths()',
    'public.confirm_fiscal_xml_cleanup(text[])',
    'public.match_sales_order_for_invoice(text,text,jsonb)',
    'public.get_stock_reservation_reviews(text)',
    'public.resolve_stock_reservation_review(text,text,text)'
  ] loop
    target := to_regprocedure(signature);
    if target is null then
      raise exception 'Função de estoque não encontrada: %', signature;
    end if;
    definition := pg_get_functiondef(target);
    definition := replace(definition, 'public.can_manage_catalog()', 'public.can_manage_stock()');
    execute definition;
  end loop;
end $$;

grant execute on function public.is_admin_expedition() to authenticated;
grant execute on function public.can_manage_stock() to authenticated;

notify pgrst, 'reload schema';
