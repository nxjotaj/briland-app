-- Rastreabilidade administrativa das reservas e cancelamento seguro de pedidos.
create or replace function public.get_admin_stock_reservations(p_product_code text default null)
returns table(
  "reservationId" text,
  "productId" text,
  "productCode" text,
  "productName" text,
  "orderId" text,
  "orderNumber" bigint,
  "orderStatus" text,
  quantity integer,
  "clientName" text,
  "representativeName" text,
  "submittedAt" timestamptz,
  "createdAt" timestamptz
)
language sql stable security definer set search_path=public as $$
  select r.id,p.id,p."codigoInterno",p.nome,o.id,o."orderNumber",o.status,r.quantity,
    coalesce(o."clientSnapshot"->>'company',o."clientSnapshot"->>'name','-'),
    coalesce(rep.name,rep.company,rep.email,'-'),o."submittedAt",r."createdAt"
  from public."StockReservation" r
  join public."Produto" p on p.id=r."productId"
  join public."SalesOrder" o on o.id=r."orderId"
  left join public."User" rep on rep.id=o."representativeId"
  where public.can_manage_stock() and r.status='ACTIVE'
    and (nullif(btrim(p_product_code),'') is null or public.normalize_stock_product_code(p."codigoInterno") like '%'||public.normalize_stock_product_code(p_product_code)||'%')
  order by p."codigoInterno",o."orderNumber";
$$;

create or replace function public.transition_sales_order(p_order_id text,p_action text,p_comment text default null)
returns public."SalesOrder" language plpgsql security definer set search_path=public as $$
declare actor public."User"; o public."SalesOrder"; target text; result public."SalesOrder"; action_value text:=upper(coalesce(p_action,''));
begin
  select * into actor from public.current_app_user();
  select * into o from public."SalesOrder" where id=p_order_id for update;
  if o.id is null then raise exception 'Pedido não encontrado.'; end if;
  if action_value='CANCEL' and actor.role::text='REPRESENTANTE' and o."representativeId"=actor.id and o.status in ('DRAFT','RETURNED','SUBMITTED') then target:='CANCELLED';
  elsif action_value='CANCEL' and public.is_sales_admin() and o.status in ('SUBMITTED','APPROVED') then target:='CANCELLED';
  elsif public.is_sales_admin() and o.status='SUBMITTED' and action_value in ('RETURN','REJECT','APPROVE') then target:=case action_value when 'RETURN' then 'RETURNED' when 'REJECT' then 'REJECTED' else 'APPROVED' end;
  else raise exception using errcode='42501',message='Transição de pedido não permitida para o status atual.'; end if;
  if target in ('RETURNED','REJECTED','CANCELLED') then perform public.release_sales_order_reservations(p_order_id); end if;
  update public."SalesOrder" set status=target,"approvedAt"=case when target='APPROVED' then now() else "approvedAt" end,"updatedAt"=now() where id=p_order_id returning * into result;
  insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName",metadata)
  values(p_order_id,target,nullif(btrim(coalesce(p_comment,'')),''),actor.id,actor.name,
    case when target='APPROVED' then jsonb_build_object('stockAction','RESERVATION_MAINTAINED_UNTIL_INVOICE') when target='CANCELLED' then jsonb_build_object('stockAction','ACTIVE_RESERVATIONS_RELEASED') else '{}'::jsonb end);
  return result;
end $$;

revoke all on function public.get_admin_stock_reservations(text) from public;
grant execute on function public.get_admin_stock_reservations(text) to authenticated;
revoke all on function public.transition_sales_order(text,text,text) from public;
grant execute on function public.transition_sales_order(text,text,text) to authenticated;
notify pgrst, 'reload schema';
