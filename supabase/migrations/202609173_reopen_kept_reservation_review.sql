create or replace function public.resolve_stock_reservation_review(p_review_id text,p_action text,p_comment text)
returns public."StockReservationReview" language plpgsql security definer set search_path=public as $$
declare actor public."User"; review public."StockReservationReview"; target text; result public."StockReservationReview";
begin
  if not public.can_manage_catalog() then raise exception using errcode='42501',message='Acesso não autorizado.'; end if;
  select * into actor from public.current_app_user(); select * into review from public."StockReservationReview" where id=p_review_id for update;
  if review.id is null or review.status not in ('PENDING','KEPT_RESERVED') then raise exception 'Esta pendência não está disponível para decisão.'; end if;
  target:=upper(coalesce(p_action,'')); if target not in ('KEEP','RELEASE') then raise exception 'Escolha manter ou liberar a reserva.'; end if;
  if review.status='KEPT_RESERVED' and target='KEEP' then raise exception 'Esta reserva já foi mantida.'; end if;
  if target='RELEASE' then update public."StockReservation" set status='RELEASED',"releasedAt"=now(),"updatedAt"=now() where "orderId"=review."orderId" and "productId"=review."productId" and status='ACTIVE'; end if;
  update public."StockReservationReview" set status=case when target='KEEP' then 'KEPT_RESERVED' else 'RELEASED' end,"resolvedBy"=actor.id,"resolutionComment"=nullif(btrim(coalesce(p_comment,'')),''),"resolvedAt"=now(),"updatedAt"=now() where id=p_review_id returning * into result;
  insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName",metadata) values(review."orderId",case when target='KEEP' then 'SHORTAGE_RESERVATION_KEPT' else 'SHORTAGE_RESERVATION_RELEASED' end,nullif(btrim(coalesce(p_comment,'')),''),actor.id,actor.name,jsonb_build_object('reviewId',review.id,'productId',review."productId",'remainingQuantity',review."remainingQuantity"));
  if target='RELEASE' and not exists(select 1 from public."StockReservationReview" where "orderId"=review."orderId" and status in ('PENDING','KEPT_RESERVED')) then update public."SalesOrder" set status='INVOICED',"updatedAt"=now() where id=review."orderId"; end if;
  return result;
end $$;
