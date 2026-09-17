begin;

alter table public."SalesOrder" drop constraint if exists "SalesOrder_status_check";
alter table public."SalesOrder" add constraint "SalesOrder_status_check" check (status in ('DRAFT','SUBMITTED','RETURNED','APPROVED','INVOICED','REJECTED','CANCELLED'));
alter table public."SalesOrder" add column if not exists "invoicedAt" timestamptz null;
alter table public."SalesOrder" add column if not exists "stockDeductedAt" timestamptz null;
alter table public."SalesOrder" add column if not exists "fiscalDocumentId" text null;
alter table public."StockFiscalDocument" add column if not exists "salesOrderId" text null references public."SalesOrder"(id) on delete set null;
alter table public."StockFiscalDocument" add column if not exists "orderComparison" jsonb null;
alter table public."StockMovement" add column if not exists "salesOrderId" text null references public."SalesOrder"(id) on delete set null;

update public."SalesOrder" o set "stockDeductedAt"=coalesce(o."approvedAt",o."updatedAt")
where o.status='APPROVED' and o."stockDeductedAt" is null
  and exists(select 1 from public."StockBatch" b where b.reason='Pedido '||lpad(o."orderNumber"::text,6,'0') and b.status='APLICADO');

update public."StockMovement" m set "salesOrderId"=o.id
from public."StockBatch" b, public."SalesOrder" o
where m."batchId"=b.id and b.reason='Pedido '||lpad(o."orderNumber"::text,6,'0') and m."salesOrderId" is null;

create index if not exists "StockFiscalDocument_sales_order_idx" on public."StockFiscalDocument"("salesOrderId");
create unique index if not exists "StockFiscalDocument_sales_order_invoice_unique" on public."StockFiscalDocument"("salesOrderId") where "salesOrderId" is not null and nature<>'CANCELAMENTO';

create or replace function public.sales_order_invoice_comparison(p_order_id text,p_items jsonb)
returns jsonb language sql stable security definer set search_path=public as $$
with order_lines as (
  select public.normalize_stock_product_code(i."productCode") code,sum(i.quantity)::integer quantity
  from public."SalesOrderItem" i where i."orderId"=p_order_id group by 1
), invoice_lines as (
  select public.normalize_stock_product_code(x->>'productCode') code,sum((x->>'quantity')::numeric)::integer quantity
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x group by 1
), compared as (
  select coalesce(o.code,n.code) code,o.quantity "orderQuantity",n.quantity "invoiceQuantity",
    case when o.code is null then 'EXTRA_IN_INVOICE' when n.code is null then 'MISSING_IN_INVOICE' when o.quantity<>n.quantity then 'QUANTITY_CHANGED' else 'MATCH' end result
  from order_lines o full join invoice_lines n using(code)
)
select jsonb_build_object(
  'exact',coalesce(bool_and(result='MATCH'),false),
  'differences',coalesce(jsonb_agg(to_jsonb(compared) order by code) filter(where result<>'MATCH'),'[]'::jsonb),
  'lines',coalesce(jsonb_agg(to_jsonb(compared) order by code),'[]'::jsonb)
) from compared;
$$;

create or replace function public.match_sales_order_for_invoice(p_recipient_cnpj text,p_recipient_ie text,p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.can_manage_catalog() then raise exception using errcode='42501',message='Acesso não autorizado.'; end if;
  select jsonb_build_object('orderId',o.id,'orderNumber',o."orderNumber",'clientName',coalesce(o."clientSnapshot"->>'company',o."clientSnapshot"->>'name'),'comparison',public.sales_order_invoice_comparison(o.id,p_items)) into result
  from public."SalesOrder" o
  where o.status='APPROVED' and o."fiscalDocumentId" is null
    and regexp_replace(coalesce(o."clientSnapshot"->>'cnpj',''),'\D','','g')=regexp_replace(coalesce(p_recipient_cnpj,''),'\D','','g')
    and (nullif(regexp_replace(upper(coalesce(p_recipient_ie,'')),'[^A-Z0-9]','','g'),'') is null
      or nullif(regexp_replace(upper(coalesce(o."clientSnapshot"->>'stateRegistration','')),'[^A-Z0-9]','','g'),'') is null
      or regexp_replace(upper(coalesce(o."clientSnapshot"->>'stateRegistration','')),'[^A-Z0-9]','','g')=regexp_replace(upper(coalesce(p_recipient_ie,'')),'[^A-Z0-9]','','g'))
  order by ((public.sales_order_invoice_comparison(o.id,p_items)->>'exact')::boolean) desc,o."approvedAt" asc nulls last,o."orderNumber" asc limit 1;
  return coalesce(result,'null'::jsonb);
end $$;

create or replace function public.transition_sales_order(p_order_id text,p_action text,p_comment text default null)
returns public."SalesOrder" language plpgsql security definer set search_path=public as $$
declare actor public."User"; o public."SalesOrder"; target text; result public."SalesOrder";
begin
  select * into actor from public.current_app_user(); select * into o from public."SalesOrder" where id=p_order_id for update;
  if o.id is null then raise exception 'Pedido não encontrado.'; end if;
  if upper(p_action)='CANCEL' and actor.role::text='REPRESENTANTE' and o."representativeId"=actor.id and o.status in ('DRAFT','RETURNED') then target:='CANCELLED';
  elsif public.is_sales_admin() and o.status='SUBMITTED' and upper(p_action) in ('RETURN','REJECT','APPROVE') then target:=case upper(p_action) when 'RETURN' then 'RETURNED' when 'REJECT' then 'REJECTED' else 'APPROVED' end;
  else raise exception using errcode='42501',message='Transição de pedido não permitida.'; end if;
  if target in ('RETURNED','REJECTED','CANCELLED') then perform public.release_sales_order_reservations(p_order_id); end if;
  update public."SalesOrder" set status=target,"approvedAt"=case when target='APPROVED' then now() else "approvedAt" end,"updatedAt"=now() where id=p_order_id returning * into result;
  insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName",metadata) values(p_order_id,target,nullif(btrim(coalesce(p_comment,'')),''),actor.id,actor.name,case when target='APPROVED' then jsonb_build_object('stockAction','RESERVATION_MAINTAINED_UNTIL_INVOICE') else '{}'::jsonb end);
  return result;
end $$;

create or replace function public.apply_fiscal_stock_batch(p_direction text,p_reason text,p_documents jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor public."User"; batch_id text; document jsonb; item jsonb; doc_id text; product_row public."Produto"; order_row public."SalesOrder";
  normalized_code text; qty numeric; delta integer; current_balance integer; next_balance integer; document_count integer:=0; movement_count integer:=0;
  direction_value text:=upper(coalesce(p_direction,'')); nature_value text; access_key text; event_id text; original_doc public."StockFiscalDocument"; original_movement record;
  sales_order_id text; comparison jsonb; already_deducted boolean:=false; reconciliation record;
begin
  if not public.can_manage_catalog() then raise exception using errcode='42501',message='Somente administradores autorizados podem processar XML fiscal.'; end if;
  if direction_value not in ('ENTRADA','SAIDA') then raise exception using errcode='22023',message='Escolha se o lote é de entrada ou saída.'; end if;
  if jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents)=0 then raise exception using errcode='22023',message='Inclua ao menos um XML válido.'; end if;
  if (direction_value='ENTRADA' and jsonb_array_length(p_documents)>10) or (direction_value='SAIDA' and jsonb_array_length(p_documents)>50) then raise exception using errcode='22023',message='O lote excede o limite permitido.'; end if;
  select * into actor from public.current_app_user(); batch_id:='stock_batch_'||gen_random_uuid()::text;
  insert into public."StockBatch"(id,direction,status,source,reason,"createdBy") values(batch_id,direction_value,'VALIDADO','XML',nullif(btrim(p_reason),''),actor.id);
  for document in select * from jsonb_array_elements(p_documents) loop
    nature_value:=upper(coalesce(document->>'nature','NAO_RECONHECIDA')); access_key:=nullif(regexp_replace(coalesce(document->>'accessKey',''),'\D','','g'),''); event_id:=nullif(btrim(document->>'eventId'),''); sales_order_id:=nullif(btrim(document->>'salesOrderId'),''); already_deducted:=false; comparison:=null;
    if nature_value not in ('COMPRA_IMPORTACAO','VENDA','TRANSFERENCIA','DEVOLUCAO','CANCELAMENTO') then raise exception using errcode='22023',message='Existe documento sem natureza fiscal reconhecida.'; end if;
    if coalesce((document->>'classifiedManually')::boolean,false) and nullif(btrim(document->>'manualClassificationReason'),'') is null then raise exception using errcode='22023',message='Informe a justificativa da classificação fiscal manual.'; end if;
    if ((nature_value='COMPRA_IMPORTACAO' and direction_value='SAIDA') or (nature_value='VENDA' and direction_value='ENTRADA')) and nullif(btrim(document->>'manualClassificationReason'),'') is null then raise exception using errcode='22023',message='A natureza fiscal contradiz a direção do lote.'; end if;
    if coalesce((document->>'authorized')::boolean,false)=false then raise exception using errcode='22023',message='Somente NF-e autorizada ou evento fiscal válido pode movimentar saldo.'; end if;
    if nature_value='CANCELAMENTO' then
      if event_id is null or access_key is null then raise exception using errcode='22023',message='O cancelamento não possui chave ou evento.'; end if;
      if exists(select 1 from public."StockFiscalDocument" where "eventId"=event_id) then raise exception using errcode='23505',message='Este cancelamento já foi processado.'; end if;
      select * into original_doc from public."StockFiscalDocument" where "accessKey"=access_key and nature<>'CANCELAMENTO' limit 1;
      if original_doc.id is null then raise exception 'A NF-e precisa ter sido processada antes do cancelamento.'; end if;
      doc_id:='stock_doc_'||gen_random_uuid()::text;
      insert into public."StockFiscalDocument"(id,"batchId","accessKey","eventId",nature,direction,"storagePath","storageExpiresAt","reversesDocumentId","salesOrderId") values(doc_id,batch_id,access_key,event_id,'CANCELAMENTO',direction_value,document->>'storagePath',now()+interval '90 days',original_doc.id,original_doc."salesOrderId");
      for original_movement in select * from public."StockMovement" where "documentId"=original_doc.id order by "createdAt" loop
        select * into product_row from public."Produto" where id=original_movement."productId" for update; current_balance:=coalesce(product_row.estoque,0); next_balance:=current_balance-original_movement.quantity;
        if next_balance<0 then raise exception 'O cancelamento faria o saldo ficar negativo.'; end if;
        update public."Produto" set estoque=next_balance,"updatedAt"=now() where id=product_row.id;
        insert into public."StockMovement"("batchId","documentId","productId",kind,quantity,"previousBalance","newBalance",reason,"createdBy","salesOrderId") values(batch_id,doc_id,product_row.id,'REVERSAO',-original_movement.quantity,current_balance,next_balance,'Cancelamento da NF-e '||access_key,actor.id,original_doc."salesOrderId"); movement_count:=movement_count+1;
      end loop;
      if original_doc."salesOrderId" is not null then
        update public."StockReservation" r set status='ACTIVE',quantity=i.quantity,"releasedAt"=null,"updatedAt"=now() from public."SalesOrderItem" i where i."orderId"=original_doc."salesOrderId" and r."orderId"=i."orderId" and r."productId"=i."productId";
        update public."SalesOrder" set status='APPROVED',"invoicedAt"=null,"stockDeductedAt"=null,"fiscalDocumentId"=null,"updatedAt"=now() where id=original_doc."salesOrderId";
        insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName",metadata) values(original_doc."salesOrderId",'INVOICE_CANCELLED','Cancelamento da NF-e '||access_key,actor.id,actor.name,jsonb_build_object('fiscalDocumentId',doc_id));
      end if;
    else
      if access_key is null or length(access_key)<>44 then raise exception using errcode='22023',message='Existe NF-e sem chave válida.'; end if;
      if exists(select 1 from public."StockFiscalDocument" where "accessKey"=access_key and nature<>'CANCELAMENTO') then raise exception using errcode='23505',message='Esta NF-e já foi processada.'; end if;
      if jsonb_typeof(document->'items')<>'array' or jsonb_array_length(document->'items')=0 then raise exception 'A NF-e não possui itens.'; end if;
      if sales_order_id is not null then
        select * into order_row from public."SalesOrder" where id=sales_order_id for update;
        if order_row.id is null or order_row.status<>'APPROVED' then raise exception 'O pedido vinculado não está aprovado ou já foi faturado.'; end if;
        if regexp_replace(coalesce(order_row."clientSnapshot"->>'cnpj',''),'\D','','g')<>regexp_replace(coalesce(document->'recipient'->>'cnpj',''),'\D','','g') then raise exception 'O CNPJ da NF-e não pertence ao cliente do pedido.'; end if;
        if nullif(regexp_replace(upper(coalesce(order_row."clientSnapshot"->>'stateRegistration','')),'[^A-Z0-9]','','g'),'') is not null and nullif(regexp_replace(upper(coalesce(document->'recipient'->>'ie','')),'[^A-Z0-9]','','g'),'') is not null and regexp_replace(upper(order_row."clientSnapshot"->>'stateRegistration'),'[^A-Z0-9]','','g')<>regexp_replace(upper(document->'recipient'->>'ie'),'[^A-Z0-9]','','g') then raise exception 'A inscrição estadual da NF-e não pertence ao cliente do pedido.'; end if;
        comparison:=public.sales_order_invoice_comparison(sales_order_id,document->'items'); already_deducted:=order_row."stockDeductedAt" is not null;
      end if;
      doc_id:='stock_doc_'||gen_random_uuid()::text;
      insert into public."StockFiscalDocument"(id,"batchId","accessKey",number,series,"issuedAt",issuer,recipient,purpose,"operationNature",cfops,nature,direction,"manualClassificationReason","storagePath","storageExpiresAt","salesOrderId","orderComparison")
      values(doc_id,batch_id,access_key,document->>'number',document->>'series',nullif(document->>'issuedAt','')::timestamptz,coalesce(document->'issuer','{}'),coalesce(document->'recipient','{}'),document->>'purpose',document->>'operationNature',array(select jsonb_array_elements_text(coalesce(document->'cfops','[]'))),nature_value,direction_value,nullif(document->>'manualClassificationReason',''),document->>'storagePath',now()+interval '90 days',sales_order_id,comparison);
      for item in select * from jsonb_array_elements(document->'items') loop
        normalized_code:=public.normalize_stock_product_code(item->>'productCode'); qty:=nullif(item->>'quantity','')::numeric;
        if qty is null or qty<=0 or qty<>trunc(qty) then raise exception 'A quantidade fiscal deve ser inteira e positiva.'; end if;
        select * into product_row from public."Produto" p where public.normalize_stock_product_code(p."codigoInterno")=normalized_code for update;
        if product_row.id is null then raise exception 'Produto fiscal não encontrado: %.',normalized_code; end if;
        insert into public."StockFiscalItem"("documentId","lineNumber","productCode",description,quantity,cfop,"productId") values(doc_id,coalesce((item->>'lineNumber')::integer,1),normalized_code,item->>'description',qty,item->>'cfop',product_row.id);
        if not already_deducted then
          delta:=case when direction_value='ENTRADA' then qty::integer else -qty::integer end; current_balance:=coalesce(product_row.estoque,0); next_balance:=current_balance+delta;
          if next_balance<0 then raise exception 'A NF-e faria o produto % ficar com saldo negativo.',normalized_code; end if;
          update public."Produto" set estoque=next_balance,"updatedAt"=now() where id=product_row.id;
          insert into public."StockMovement"("batchId","documentId","productId",kind,quantity,"previousBalance","newBalance",reason,"createdBy","salesOrderId") values(batch_id,doc_id,product_row.id,direction_value,delta,current_balance,next_balance,coalesce(nullif(btrim(p_reason),''),nature_value||' — NF-e '||access_key),actor.id,sales_order_id); movement_count:=movement_count+1;
        end if;
      end loop;
      if already_deducted then
        update public."StockMovement" set "documentId"=doc_id where "salesOrderId"=sales_order_id and "documentId" is null;
        for reconciliation in with oq as (select "productId",sum(quantity)::integer q from public."SalesOrderItem" where "orderId"=sales_order_id group by 1), iq as (select "productId",sum(quantity)::integer q from public."StockFiscalItem" where "documentId"=doc_id group by 1) select coalesce(oq."productId",iq."productId") product_id,coalesce(oq.q,0)-coalesce(iq.q,0) adjustment from oq full join iq using("productId") loop
          if reconciliation.adjustment<>0 then select * into product_row from public."Produto" where id=reconciliation.product_id for update; current_balance:=coalesce(product_row.estoque,0); next_balance:=current_balance+reconciliation.adjustment; if next_balance<0 then raise exception 'A conciliação faria o saldo ficar negativo.'; end if; update public."Produto" set estoque=next_balance,"updatedAt"=now() where id=product_row.id; insert into public."StockMovement"("batchId","documentId","productId",kind,quantity,"previousBalance","newBalance",reason,"createdBy","salesOrderId") values(batch_id,doc_id,product_row.id,'AJUSTE',reconciliation.adjustment,current_balance,next_balance,'Conciliação do pedido '||lpad(order_row."orderNumber"::text,6,'0')||' com a NF-e '||access_key,actor.id,sales_order_id); movement_count:=movement_count+1; end if;
        end loop;
      end if;
      if sales_order_id is not null then
        perform public.release_sales_order_reservations(sales_order_id,'CONSUMED');
        update public."SalesOrder" set status='INVOICED',"invoicedAt"=now(),"stockDeductedAt"=coalesce("stockDeductedAt",now()),"fiscalDocumentId"=doc_id,"updatedAt"=now() where id=sales_order_id;
        insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName",metadata) values(sales_order_id,'INVOICED','Faturado pela NF-e '||coalesce(document->>'number',access_key),actor.id,actor.name,jsonb_build_object('accessKey',access_key,'fiscalDocumentId',doc_id,'comparison',comparison,'stockAlreadyDeducted',already_deducted));
      end if;
    end if;
    document_count:=document_count+1;
  end loop;
  update public."StockBatch" set status='APLICADO',"appliedAt"=now(),"updatedAt"=now() where id=batch_id;
  return jsonb_build_object('batchId',batch_id,'documentsProcessed',document_count,'movementsCreated',movement_count);
end $$;

revoke all on function public.match_sales_order_for_invoice(text,text,jsonb) from public;
grant execute on function public.match_sales_order_for_invoice(text,text,jsonb) to authenticated;
grant execute on function public.sales_order_invoice_comparison(text,jsonb) to authenticated;

commit;
