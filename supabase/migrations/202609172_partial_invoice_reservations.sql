begin;

alter table public."SalesOrder" drop constraint if exists "SalesOrder_status_check";
alter table public."SalesOrder" add constraint "SalesOrder_status_check" check (status in ('DRAFT','SUBMITTED','RETURNED','APPROVED','PARTIALLY_INVOICED','INVOICED','REJECTED','CANCELLED'));

create table if not exists public."StockReservationReview" (
  id text primary key default ('stock_review_'||gen_random_uuid()::text),
  "orderId" text not null references public."SalesOrder"(id) on delete cascade,
  "fiscalDocumentId" text not null references public."StockFiscalDocument"(id) on delete cascade,
  "productId" text not null references public."Produto"(id) on delete restrict,
  "orderedQuantity" integer not null,
  "invoicedQuantity" integer not null,
  "remainingQuantity" integer not null check ("remainingQuantity">0),
  status text not null default 'PENDING' check (status in ('PENDING','KEPT_RESERVED','RELEASED')),
  "resolvedBy" text null references public."User"(id) on delete set null,
  "resolutionComment" text null,
  "resolvedAt" timestamptz null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique("orderId","fiscalDocumentId","productId")
);
alter table public."StockReservationReview" enable row level security;
drop policy if exists "admins manage stock reservation reviews" on public."StockReservationReview";
create policy "admins manage stock reservation reviews" on public."StockReservationReview" for all to authenticated using(public.can_manage_catalog()) with check(public.can_manage_catalog());
grant select on public."StockReservationReview" to authenticated;
create index if not exists "StockReservationReview_status_created_idx" on public."StockReservationReview"(status,"createdAt" desc);

alter function public.apply_fiscal_stock_batch(text,text,jsonb) rename to apply_fiscal_stock_batch_invoice_v1;

create or replace function public.apply_fiscal_stock_batch(p_direction text,p_reason text,p_documents jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; document jsonb; order_id text; fiscal_id text; order_row public."SalesOrder"; shortage record; has_shortage boolean;
begin
  result:=public.apply_fiscal_stock_batch_invoice_v1(p_direction,p_reason,p_documents);
  if upper(coalesce(p_direction,''))<>'SAIDA' then return result; end if;
  for document in select * from jsonb_array_elements(p_documents) loop
    order_id:=nullif(btrim(document->>'salesOrderId'),'');
    if order_id is null then continue; end if;
    select * into order_row from public."SalesOrder" where id=order_id for update;
    fiscal_id:=order_row."fiscalDocumentId"; has_shortage:=false;
    for shortage in
      with invoiced as (
        select sfi."productId",sum(sfi.quantity)::integer quantity from public."StockFiscalItem" sfi where sfi."documentId"=fiscal_id group by 1
      )
      select i."productId",i."productCode",i."productName",i.quantity ordered_quantity,coalesce(f.quantity,0) invoiced_quantity,greatest(i.quantity-coalesce(f.quantity,0),0) remaining_quantity
      from public."SalesOrderItem" i left join invoiced f on f."productId"=i."productId" where i."orderId"=order_id
    loop
      if shortage.remaining_quantity>0 then
        has_shortage:=true;
        update public."StockReservation" set quantity=shortage.remaining_quantity,status='ACTIVE',"releasedAt"=null,"updatedAt"=now() where "orderId"=order_id and "productId"=shortage."productId";
        insert into public."StockReservationReview"("orderId","fiscalDocumentId","productId","orderedQuantity","invoicedQuantity","remainingQuantity") values(order_id,fiscal_id,shortage."productId",shortage.ordered_quantity,shortage.invoiced_quantity,shortage.remaining_quantity)
        on conflict("orderId","fiscalDocumentId","productId") do update set "orderedQuantity"=excluded."orderedQuantity","invoicedQuantity"=excluded."invoicedQuantity","remainingQuantity"=excluded."remainingQuantity",status='PENDING',"updatedAt"=now();
      end if;
    end loop;
    if has_shortage then
      update public."SalesOrder" set status='PARTIALLY_INVOICED',"updatedAt"=now() where id=order_id;
      insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName",metadata)
      select order_id,'INVOICE_SHORTAGE_REVIEW_CREATED','NF-e com quantidade inferior ao pedido. O saldo restante permanece reservado.',u.id,u.name,
        jsonb_build_object('fiscalDocumentId',fiscal_id,'invoiceNumber',d.number,'invoiceIssuedAt',d."issuedAt",'orderCreatedAt',order_row."createdAt",'shortages',coalesce((select jsonb_agg(jsonb_build_object('productId',r."productId",'orderedQuantity',r."orderedQuantity",'invoicedQuantity',r."invoicedQuantity",'remainingQuantity',r."remainingQuantity")) from public."StockReservationReview" r where r."orderId"=order_id and r."fiscalDocumentId"=fiscal_id),'[]'::jsonb))
      from public.current_app_user() u join public."StockFiscalDocument" d on d.id=fiscal_id;
    end if;
  end loop;
  return result;
end $$;

create or replace function public.get_stock_reservation_reviews(p_status text default null)
returns table("reviewId" text,"orderId" text,"orderNumber" bigint,"orderCreatedAt" timestamptz,"invoiceNumber" text,"invoiceIssuedAt" timestamptz,"accessKey" text,"clientName" text,"productId" text,"productCode" text,"productName" text,"orderedQuantity" integer,"invoicedQuantity" integer,"remainingQuantity" integer,status text,"createdAt" timestamptz,"resolutionComment" text)
language sql stable security definer set search_path=public as $$
  select r.id,r."orderId",o."orderNumber",o."createdAt",d.number,d."issuedAt",d."accessKey",coalesce(o."clientSnapshot"->>'company',o."clientSnapshot"->>'name'),r."productId",p."codigoInterno",p.nome,r."orderedQuantity",r."invoicedQuantity",r."remainingQuantity",r.status,r."createdAt",r."resolutionComment"
  from public."StockReservationReview" r join public."SalesOrder" o on o.id=r."orderId" join public."StockFiscalDocument" d on d.id=r."fiscalDocumentId" join public."Produto" p on p.id=r."productId"
  where public.can_manage_catalog() and (nullif(upper(btrim(coalesce(p_status,''))),'') is null or r.status=upper(btrim(p_status))) order by case when r.status='PENDING' then 0 else 1 end,r."createdAt" desc;
$$;

create or replace function public.resolve_stock_reservation_review(p_review_id text,p_action text,p_comment text)
returns public."StockReservationReview" language plpgsql security definer set search_path=public as $$
declare actor public."User"; review public."StockReservationReview"; target text; result public."StockReservationReview"; order_number bigint;
begin
  if not public.can_manage_catalog() then raise exception using errcode='42501',message='Acesso não autorizado.'; end if;
  select * into actor from public.current_app_user(); select * into review from public."StockReservationReview" where id=p_review_id for update;
  if review.id is null or review.status not in ('PENDING','KEPT_RESERVED') then raise exception 'Esta pendência não está disponível para decisão.'; end if;
  target:=upper(coalesce(p_action,'')); if target not in ('KEEP','RELEASE') then raise exception 'Escolha manter ou liberar a reserva.'; end if;
  if review.status='KEPT_RESERVED' and target='KEEP' then raise exception 'Esta reserva já foi mantida.'; end if;
  if target='RELEASE' then
    update public."StockReservation" set status='RELEASED',"releasedAt"=now(),"updatedAt"=now() where "orderId"=review."orderId" and "productId"=review."productId" and status='ACTIVE';
  end if;
  update public."StockReservationReview" set status=case when target='KEEP' then 'KEPT_RESERVED' else 'RELEASED' end,"resolvedBy"=actor.id,"resolutionComment"=nullif(btrim(coalesce(p_comment,'')),''),"resolvedAt"=now(),"updatedAt"=now() where id=p_review_id returning * into result;
  select "orderNumber" into order_number from public."SalesOrder" where id=review."orderId";
  insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName",metadata) values(review."orderId",case when target='KEEP' then 'SHORTAGE_RESERVATION_KEPT' else 'SHORTAGE_RESERVATION_RELEASED' end,nullif(btrim(coalesce(p_comment,'')),''),actor.id,actor.name,jsonb_build_object('reviewId',review.id,'productId',review."productId",'remainingQuantity',review."remainingQuantity"));
  if target='RELEASE' and not exists(select 1 from public."StockReservationReview" where "orderId"=review."orderId" and status in ('PENDING','KEPT_RESERVED')) then update public."SalesOrder" set status='INVOICED',"updatedAt"=now() where id=review."orderId"; end if;
  return result;
end $$;

revoke all on function public.get_stock_reservation_reviews(text) from public;
revoke all on function public.resolve_stock_reservation_review(text,text,text) from public;
grant execute on function public.get_stock_reservation_reviews(text) to authenticated;
grant execute on function public.resolve_stock_reservation_review(text,text,text) to authenticated;

commit;
