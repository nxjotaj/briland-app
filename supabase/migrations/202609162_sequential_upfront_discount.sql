create or replace function public.save_sales_order(
  p_order_id text, p_client_id text, p_freight_type text, p_redispatch_name text,
  p_redispatch_phone text, p_payment_type text, p_payment_terms text, p_notes text,
  p_items jsonb, p_submit boolean default false
)
returns public."SalesOrder" language plpgsql security definer set search_path=public
as $$
declare actor public."User"; order_row public."SalesOrder"; client_row public."User"; product_row public."Produto";
  item jsonb; manual_discount numeric; payment_discount numeric; effective_discount numeric; qty integer;
  line_list numeric; unit_price numeric; line_total numeric; sum_list numeric:=0; sum_total numeric:=0; reserved integer; idx integer:=0;
  old_snapshot jsonb; result public."SalesOrder"; actor_is_admin boolean;
begin
  perform public.expire_abandoned_sales_order_drafts();
  select * into actor from public.current_app_user(); actor_is_admin:=public.is_sales_admin();
  select * into order_row from public."SalesOrder" where id=p_order_id for update;
  if order_row.id is null then raise exception 'Pedido não encontrado.'; end if;
  if not actor_is_admin and (actor.role::text<>'REPRESENTANTE' or order_row."representativeId"<>actor.id or order_row.status not in ('DRAFT','RETURNED')) then raise exception using errcode='42501',message='Este pedido não pode ser editado.'; end if;
  if actor_is_admin and order_row.status <> 'SUBMITTED' then raise exception 'O administrador só pode editar pedidos enviados.'; end if;
  select * into client_row from public."User" where id=p_client_id and role='CLIENTE' and status='ACTIVE';
  if client_row.id is null or client_row."representanteId"<>order_row."representativeId" then raise exception 'Selecione um cliente ativo vinculado ao representante.'; end if;
  if upper(coalesce(p_freight_type,'')) not in ('CIF','FOB') then raise exception 'Informe CIF ou FOB.'; end if;
  if upper(coalesce(p_payment_type,'')) not in ('UPFRONT','INSTALLMENTS') then raise exception 'Informe a condição de pagamento.'; end if;
  if upper(p_payment_type)='INSTALLMENTS' and nullif(btrim(coalesce(p_payment_terms,'')),'') is null then raise exception 'Informe o prazo do pagamento parcelado.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Adicione ao menos um produto.'; end if;
  old_snapshot:=to_jsonb(order_row)||(select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(i) order by i."sortOrder"),'[]'::jsonb)) from public."SalesOrderItem" i where i."orderId"=p_order_id);
  if actor_is_admin then perform public.release_sales_order_reservations(p_order_id); end if;
  delete from public."SalesOrderItem" where "orderId"=p_order_id;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into product_row from public."Produto" where id=item->>'productId' and ativo=true for update;
    if product_row.id is null or product_row.preco is null then raise exception 'Existe produto inválido ou sem preço de tabela.'; end if;
    qty:=(item->>'quantity')::integer; manual_discount:=round(coalesce((item->>'manualDiscountPercent')::numeric,0),2);
    if qty<=0 then raise exception 'As quantidades devem ser inteiras e positivas.'; end if;
    if manual_discount<0 or manual_discount>coalesce(actor."orderDiscountLimit",15) and not actor_is_admin then raise exception 'O desconto excede o limite do representante.'; end if;
    if actor_is_admin and (manual_discount<0 or manual_discount>100) then raise exception 'O desconto deve estar entre 0 e 100%%.'; end if;
    payment_discount:=case when upper(p_payment_type)='UPFRONT' then 5 else 0 end;
    effective_discount:=round(100-((100-manual_discount)*(100-payment_discount)/100),2);
    unit_price:=round(product_row.preco*(1-manual_discount/100)*(1-payment_discount/100),2);
    line_list:=round(product_row.preco*qty,2); line_total:=round(unit_price*qty,2);
    insert into public."SalesOrderItem"("orderId","productId","productCode","productName",quantity,"listPrice","manualDiscountPercent","paymentDiscountPercent","effectiveDiscountPercent","unitPrice","lineTotal","sortOrder")
    values(p_order_id,product_row.id,coalesce(product_row."codigoInterno",product_row.id),product_row.nome,qty,product_row.preco,manual_discount,payment_discount,effective_discount,unit_price,line_total,idx);
    sum_list:=sum_list+line_list; sum_total:=sum_total+line_total; idx:=idx+1;
    if p_submit or actor_is_admin then
      select coalesce(sum(r.quantity),0)::integer into reserved from public."StockReservation" r where r."productId"=product_row.id and r.status='ACTIVE';
      if coalesce(product_row.estoque,0)-reserved < qty then raise exception 'Saldo disponível insuficiente para o produto %.',coalesce(product_row."codigoInterno",product_row.nome); end if;
      insert into public."StockReservation"("orderId","productId",quantity) values(p_order_id,product_row.id,qty)
      on conflict("orderId","productId") do update set quantity=excluded.quantity,status='ACTIVE',"releasedAt"=null,"updatedAt"=now();
    end if;
  end loop;
  update public."SalesOrder" set "clientId"=client_row.id,"freightType"=upper(p_freight_type),"redispatchName"=nullif(btrim(coalesce(p_redispatch_name,'')),''),
    "redispatchPhone"=nullif(btrim(coalesce(p_redispatch_phone,'')),''),"paymentType"=upper(p_payment_type),"paymentTerms"=case when upper(p_payment_type)='INSTALLMENTS' then btrim(p_payment_terms) else null end,
    notes=nullif(btrim(coalesce(p_notes,'')),''),subtotal=sum_list,discount=sum_list-sum_total,total=sum_total,
    "clientSnapshot"=jsonb_build_object('id',client_row.id,'name',client_row.name,'company',client_row.company,'email',client_row.email,'phone',client_row.phone,'cnpj',client_row.cnpj,'address',client_row.address,'zipCode',client_row."zipCode",'neighborhood',client_row.neighborhood,'city',client_row.city,'state',client_row.state),
    status=case when actor_is_admin then status when p_submit then 'SUBMITTED' else 'DRAFT' end,
    "submittedAt"=case when not actor_is_admin and p_submit then now() else "submittedAt" end,"updatedAt"=now()
  where id=p_order_id returning * into result;
  insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName",metadata)
  values(p_order_id,case when actor_is_admin then 'ADMIN_EDITED' when p_submit then 'SUBMITTED' else 'SAVED' end,null,actor.id,actor.name,
    case when actor_is_admin then jsonb_build_object('before',old_snapshot,'after',to_jsonb(result)) else '{}'::jsonb end);
  return result;
end $$;

