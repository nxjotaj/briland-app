begin;

create table if not exists public."StockBatch" (
  id text primary key default ('stock_batch_' || gen_random_uuid()::text),
  direction text not null check (direction in ('ENTRADA','SAIDA','AJUSTE')),
  status text not null default 'RASCUNHO' check (status in ('RASCUNHO','EM_REVISAO','VALIDADO','APLICADO','CANCELADO','FALHOU')),
  source text not null default 'MANUAL' check (source in ('MANUAL','XML')),
  reason text null,
  "createdBy" text null references public."User"(id) on delete set null,
  "appliedAt" timestamptz null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public."StockFiscalDocument" (
  id text primary key default ('stock_doc_' || gen_random_uuid()::text),
  "batchId" text not null references public."StockBatch"(id) on delete cascade,
  "accessKey" text null,
  "eventId" text null,
  number text null,
  series text null,
  "issuedAt" timestamptz null,
  issuer jsonb not null default '{}'::jsonb,
  recipient jsonb not null default '{}'::jsonb,
  purpose text null,
  "operationNature" text null,
  cfops text[] not null default '{}',
  nature text not null check (nature in ('COMPRA_IMPORTACAO','VENDA','TRANSFERENCIA','DEVOLUCAO','CANCELAMENTO','NAO_RECONHECIDA')),
  direction text not null check (direction in ('ENTRADA','SAIDA')),
  "manualClassificationReason" text null,
  "storagePath" text null,
  "storageExpiresAt" timestamptz null,
  "reversesDocumentId" text null references public."StockFiscalDocument"(id) on delete restrict,
  "createdAt" timestamptz not null default now()
);

create unique index if not exists "StockFiscalDocument_accessKey_applied_unique"
on public."StockFiscalDocument" ("accessKey")
where "accessKey" is not null and nature <> 'CANCELAMENTO';
create unique index if not exists "StockFiscalDocument_eventId_unique"
on public."StockFiscalDocument" ("eventId") where "eventId" is not null;

create table if not exists public."StockFiscalItem" (
  id text primary key default ('stock_item_' || gen_random_uuid()::text),
  "documentId" text not null references public."StockFiscalDocument"(id) on delete cascade,
  "lineNumber" integer not null,
  "productCode" text not null,
  description text null,
  quantity numeric not null check (quantity > 0),
  cfop text null,
  "productId" text not null references public."Produto"(id) on delete restrict,
  unique ("documentId", "lineNumber")
);

create table if not exists public."StockMovement" (
  id text primary key default ('stock_mov_' || gen_random_uuid()::text),
  "batchId" text not null references public."StockBatch"(id) on delete restrict,
  "documentId" text null references public."StockFiscalDocument"(id) on delete restrict,
  "productId" text not null references public."Produto"(id) on delete restrict,
  kind text not null check (kind in ('ENTRADA','SAIDA','AJUSTE','INVENTARIO','REVERSAO')),
  quantity integer not null,
  "previousBalance" integer not null,
  "newBalance" integer not null check ("newBalance" >= 0),
  reason text not null,
  "createdBy" text null references public."User"(id) on delete set null,
  "createdAt" timestamptz not null default now()
);

create index if not exists "StockMovement_product_created_idx" on public."StockMovement" ("productId", "createdAt" desc);
create index if not exists "StockMovement_batch_idx" on public."StockMovement" ("batchId");
create index if not exists "StockFiscalDocument_key_idx" on public."StockFiscalDocument" ("accessKey");

alter table public."StockBatch" enable row level security;
alter table public."StockFiscalDocument" enable row level security;
alter table public."StockFiscalItem" enable row level security;
alter table public."StockMovement" enable row level security;

do $$
declare t text;
begin
  foreach t in array array['StockBatch','StockFiscalDocument','StockFiscalItem','StockMovement'] loop
    execute format('drop policy if exists "admins manage %s" on public.%I', lower(t), t);
    execute format('create policy "admins manage %s" on public.%I for all to authenticated using (public.can_manage_catalog()) with check (public.can_manage_catalog())', lower(t), t);
  end loop;
end $$;

create or replace function public.normalize_stock_product_code(value text)
returns text language sql immutable as $$ select upper(btrim(coalesce(value, ''))) $$;

create or replace function public.apply_manual_stock_batch(p_reason text, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  actor public."User";
  batch_id text;
  item jsonb;
  product_row public."Produto";
  normalized_code text;
  requested numeric;
  current_balance integer;
  next_balance integer;
  movement_kind text;
  changed integer := 0;
begin
  if not public.can_manage_catalog() then raise exception using errcode='42501', message='Somente administradores autorizados podem movimentar o estoque.'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023', message='Informe o motivo da manutenção de saldo.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception using errcode='22023', message='Inclua ao menos um produto no lote.'; end if;
  select * into actor from public."User" where "authUserId"=auth.uid() and status='ACTIVE' limit 1;
  batch_id := 'stock_batch_' || gen_random_uuid()::text;
  insert into public."StockBatch"(id,direction,status,source,reason,"createdBy") values(batch_id,'AJUSTE','VALIDADO','MANUAL',btrim(p_reason),actor.id);
  for item in select * from jsonb_array_elements(p_items) loop
    normalized_code := public.normalize_stock_product_code(item->>'productCode');
    if normalized_code='' then raise exception using errcode='22023', message='Existe uma linha sem código de produto.'; end if;
    if (select count(*) from public."Produto" p where public.normalize_stock_product_code(p."codigoInterno")=normalized_code) <> 1 then
      raise exception using errcode='P0001', message=format('O código %s não corresponde exatamente a um único produto.', normalized_code);
    end if;
    select * into product_row from public."Produto" p where public.normalize_stock_product_code(p."codigoInterno")=normalized_code for update;
    requested := nullif(item->>'quantity','')::numeric;
    if requested is null or requested <> trunc(requested) then raise exception using errcode='22023', message=format('A quantidade do produto %s deve ser um número inteiro.', normalized_code); end if;
    current_balance := coalesce(product_row.estoque,0);
    if upper(coalesce(item->>'mode','AJUSTE'))='INVENTARIO' then next_balance:=requested::integer; movement_kind:='INVENTARIO';
    else next_balance:=current_balance+requested::integer; movement_kind:='AJUSTE'; end if;
    if next_balance<0 then raise exception using errcode='23514', message=format('O produto %s ficaria com saldo negativo (%s). O lote não foi aplicado.',normalized_code,next_balance); end if;
    if next_balance<>current_balance then
      update public."Produto" set estoque=next_balance,"updatedAt"=now() where id=product_row.id;
      insert into public."StockMovement"("batchId","productId",kind,quantity,"previousBalance","newBalance",reason,"createdBy")
      values(batch_id,product_row.id,movement_kind,next_balance-current_balance,current_balance,next_balance,btrim(p_reason),actor.id);
      changed:=changed+1;
    end if;
  end loop;
  update public."StockBatch" set status='APLICADO',"appliedAt"=now(),"updatedAt"=now() where id=batch_id;
  return jsonb_build_object('batchId',batch_id,'productsChanged',changed);
end $$;

create or replace function public.apply_fiscal_stock_batch(p_direction text, p_reason text, p_documents jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  actor public."User"; batch_id text; document jsonb; item jsonb; doc_id text; product_row public."Produto";
  normalized_code text; qty numeric; delta integer; current_balance integer; next_balance integer; document_count integer:=0; movement_count integer:=0;
  direction_value text:=upper(coalesce(p_direction,'')); nature_value text; access_key text; event_id text; original_doc public."StockFiscalDocument"; original_movement record;
begin
  if not public.can_manage_catalog() then raise exception using errcode='42501', message='Somente administradores autorizados podem processar XML fiscal.'; end if;
  if direction_value not in ('ENTRADA','SAIDA') then raise exception using errcode='22023',message='Escolha se o lote é de entrada ou saída.'; end if;
  if jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents)=0 then raise exception using errcode='22023',message='Inclua ao menos um XML válido.'; end if;
  if (direction_value='ENTRADA' and jsonb_array_length(p_documents)>10) or (direction_value='SAIDA' and jsonb_array_length(p_documents)>50) then raise exception using errcode='22023',message='O lote excede o limite de XMLs permitido para esta operação.'; end if;
  select * into actor from public."User" where "authUserId"=auth.uid() and status='ACTIVE' limit 1;
  batch_id:='stock_batch_'||gen_random_uuid()::text;
  insert into public."StockBatch"(id,direction,status,source,reason,"createdBy") values(batch_id,direction_value,'VALIDADO','XML',nullif(btrim(p_reason),''),actor.id);
  for document in select * from jsonb_array_elements(p_documents) loop
    nature_value:=upper(coalesce(document->>'nature','NAO_RECONHECIDA')); access_key:=nullif(regexp_replace(coalesce(document->>'accessKey',''),'\D','','g'),''); event_id:=nullif(btrim(document->>'eventId'),'');
    if nature_value not in ('COMPRA_IMPORTACAO','VENDA','TRANSFERENCIA','DEVOLUCAO','CANCELAMENTO') then raise exception using errcode='22023',message='Existe um documento sem natureza fiscal reconhecida. Classifique-o e informe a justificativa antes de confirmar.'; end if;
    if coalesce((document->>'classifiedManually')::boolean,false) and nullif(btrim(document->>'manualClassificationReason'),'') is null then raise exception using errcode='22023',message='Informe a justificativa da classificação fiscal manual.'; end if;
    if ((nature_value='COMPRA_IMPORTACAO' and direction_value='SAIDA') or (nature_value='VENDA' and direction_value='ENTRADA')) and nullif(btrim(document->>'manualClassificationReason'),'') is null then raise exception using errcode='22023',message='A natureza fiscal contradiz a direção do lote. Revise a classificação e informe a justificativa.'; end if;
    if coalesce((document->>'authorized')::boolean,false)=false then raise exception using errcode='22023',message='Somente NF-e autorizada ou evento fiscal válido pode movimentar saldo.'; end if;
    if nature_value='CANCELAMENTO' then
      if event_id is null or access_key is null then raise exception using errcode='22023',message='O cancelamento não possui chave da NF-e ou identificador do evento.'; end if;
      if exists(select 1 from public."StockFiscalDocument" where "eventId"=event_id) then raise exception using errcode='23505',message='Este evento de cancelamento já foi processado.'; end if;
      select * into original_doc from public."StockFiscalDocument" where "accessKey"=access_key and nature<>'CANCELAMENTO' limit 1;
      if original_doc.id is null then raise exception using errcode='P0001',message=format('A NF-e %s precisa ter sido processada antes do cancelamento.',access_key); end if;
      if exists(select 1 from public."StockFiscalDocument" where "reversesDocumentId"=original_doc.id) then raise exception using errcode='23505',message='Esta NF-e já possui cancelamento processado.'; end if;
      doc_id:='stock_doc_'||gen_random_uuid()::text;
      insert into public."StockFiscalDocument"(id,"batchId","accessKey","eventId",nature,direction,"storagePath","storageExpiresAt","reversesDocumentId") values(doc_id,batch_id,access_key,event_id,'CANCELAMENTO',direction_value,document->>'storagePath',now()+interval '90 days',original_doc.id);
      for original_movement in select * from public."StockMovement" where "documentId"=original_doc.id order by "createdAt" loop
        select * into product_row from public."Produto" where id=original_movement."productId" for update;
        current_balance:=coalesce(product_row.estoque,0); next_balance:=current_balance-original_movement.quantity;
        if next_balance<0 then raise exception using errcode='23514',message=format('O cancelamento faria o produto %s ficar com saldo negativo.',coalesce(product_row."codigoInterno",product_row.nome)); end if;
        update public."Produto" set estoque=next_balance,"updatedAt"=now() where id=product_row.id;
        insert into public."StockMovement"("batchId","documentId","productId",kind,quantity,"previousBalance","newBalance",reason,"createdBy") values(batch_id,doc_id,product_row.id,'REVERSAO',-original_movement.quantity,current_balance,next_balance,'Cancelamento da NF-e '||access_key,actor.id);
        movement_count:=movement_count+1;
      end loop;
    else
      if access_key is null or length(access_key)<>44 then raise exception using errcode='22023',message='Existe uma NF-e sem chave de acesso válida com 44 dígitos.'; end if;
      if exists(select 1 from public."StockFiscalDocument" where "accessKey"=access_key and nature<>'CANCELAMENTO') then raise exception using errcode='23505',message=format('A NF-e %s já foi processada.',access_key); end if;
      if jsonb_typeof(document->'items')<>'array' or jsonb_array_length(document->'items')=0 then raise exception using errcode='22023',message=format('A NF-e %s não possui itens.',access_key); end if;
      doc_id:='stock_doc_'||gen_random_uuid()::text;
      insert into public."StockFiscalDocument"(id,"batchId","accessKey",number,series,"issuedAt",issuer,recipient,purpose,"operationNature",cfops,nature,direction,"manualClassificationReason","storagePath","storageExpiresAt")
      values(doc_id,batch_id,access_key,document->>'number',document->>'series',nullif(document->>'issuedAt','')::timestamptz,coalesce(document->'issuer','{}'),coalesce(document->'recipient','{}'),document->>'purpose',document->>'operationNature',array(select jsonb_array_elements_text(coalesce(document->'cfops','[]'))),nature_value,direction_value,nullif(document->>'manualClassificationReason',''),document->>'storagePath',now()+interval '90 days');
      for item in select * from jsonb_array_elements(document->'items') loop
        normalized_code:=public.normalize_stock_product_code(item->>'productCode'); qty:=nullif(item->>'quantity','')::numeric;
        if qty is null or qty<=0 or qty<>trunc(qty) then raise exception using errcode='22023',message=format('A quantidade do item %s da NF-e %s deve ser inteira e positiva.',normalized_code,access_key); end if;
        if (select count(*) from public."Produto" p where public.normalize_stock_product_code(p."codigoInterno")=normalized_code)<>1 then raise exception using errcode='P0001',message=format('O código %s da NF-e %s não corresponde exatamente a um produto.',normalized_code,access_key); end if;
        select * into product_row from public."Produto" p where public.normalize_stock_product_code(p."codigoInterno")=normalized_code for update;
        delta:=case when direction_value='ENTRADA' then qty::integer else -qty::integer end; current_balance:=coalesce(product_row.estoque,0); next_balance:=current_balance+delta;
        if next_balance<0 then raise exception using errcode='23514',message=format('A NF-e %s faria o produto %s ficar com saldo negativo.',access_key,normalized_code); end if;
        insert into public."StockFiscalItem"("documentId","lineNumber","productCode",description,quantity,cfop,"productId") values(doc_id,coalesce((item->>'lineNumber')::integer,1),normalized_code,item->>'description',qty,item->>'cfop',product_row.id);
        update public."Produto" set estoque=next_balance,"updatedAt"=now() where id=product_row.id;
        insert into public."StockMovement"("batchId","documentId","productId",kind,quantity,"previousBalance","newBalance",reason,"createdBy") values(batch_id,doc_id,product_row.id,direction_value,delta,current_balance,next_balance,coalesce(nullif(btrim(p_reason),''),nature_value||' — NF-e '||access_key),actor.id);
        movement_count:=movement_count+1;
      end loop;
    end if;
    document_count:=document_count+1;
  end loop;
  update public."StockBatch" set status='APLICADO',"appliedAt"=now(),"updatedAt"=now() where id=batch_id;
  return jsonb_build_object('batchId',batch_id,'documentsProcessed',document_count,'movementsCreated',movement_count);
end $$;

create or replace function public.get_stock_maintenance_history(p_from timestamptz default null,p_to timestamptz default null,p_product_code text default null,p_direction text default null,p_access_key text default null)
returns table("movementId" text,"createdAt" timestamptz,"batchId" text,"productId" text,"productCode" text,"productName" text,kind text,quantity integer,"previousBalance" integer,"newBalance" integer,reason text,"accessKey" text,"documentNature" text,"actorName" text,"actorEmail" text)
language sql stable security definer set search_path=public as $$
 select m.id,m."createdAt",m."batchId",m."productId",p."codigoInterno",p.nome,m.kind,m.quantity,m."previousBalance",m."newBalance",m.reason,d."accessKey",d.nature,u.name,u.email
 from public."StockMovement" m join public."Produto" p on p.id=m."productId" left join public."StockFiscalDocument" d on d.id=m."documentId" left join public."User" u on u.id=m."createdBy"
 where public.can_manage_catalog() and (p_from is null or m."createdAt">=p_from) and (p_to is null or m."createdAt"<=p_to) and (nullif(btrim(p_product_code),'') is null or public.normalize_stock_product_code(p."codigoInterno") like '%'||public.normalize_stock_product_code(p_product_code)||'%') and (nullif(upper(btrim(p_direction)),'') is null or m.kind=upper(btrim(p_direction))) and (nullif(regexp_replace(coalesce(p_access_key,''),'\D','','g'),'') is null or d."accessKey" like '%'||regexp_replace(p_access_key,'\D','','g')||'%')
 order by m."createdAt" desc limit 5000;
$$;

create or replace function public.get_expired_fiscal_xml_paths()
returns table(path text)
language sql stable security definer set search_path=public as $$
  select distinct d."storagePath"
  from public."StockFiscalDocument" d
  where public.can_manage_catalog()
    and d."storagePath" is not null
    and d."storageExpiresAt" <= now()
  limit 500;
$$;

create or replace function public.confirm_fiscal_xml_cleanup(p_paths text[])
returns integer
language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  if not public.can_manage_catalog() then raise exception using errcode='42501', message='Acesso não autorizado.'; end if;
  update public."StockFiscalDocument" set "storagePath"=null
  where "storagePath"=any(coalesce(p_paths,array[]::text[])) and "storageExpiresAt"<=now();
  get diagnostics affected=row_count;
  return affected;
end $$;

revoke all on function public.apply_manual_stock_batch(text,jsonb) from public;
revoke all on function public.apply_fiscal_stock_batch(text,text,jsonb) from public;
revoke all on function public.get_stock_maintenance_history(timestamptz,timestamptz,text,text,text) from public;
grant execute on function public.apply_manual_stock_batch(text,jsonb) to authenticated;
grant execute on function public.apply_fiscal_stock_batch(text,text,jsonb) to authenticated;
grant execute on function public.get_stock_maintenance_history(timestamptz,timestamptz,text,text,text) to authenticated;
grant execute on function public.get_expired_fiscal_xml_paths() to authenticated;
grant execute on function public.confirm_fiscal_xml_cleanup(text[]) to authenticated;
grant select on public."StockBatch",public."StockFiscalDocument",public."StockFiscalItem",public."StockMovement" to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fiscal-xml','fiscal-xml',false,10485760,array['application/xml','text/xml','application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "admins manage fiscal xml" on storage.objects;
create policy "admins manage fiscal xml" on storage.objects for all to authenticated using(bucket_id='fiscal-xml' and public.can_manage_catalog()) with check(bucket_id='fiscal-xml' and public.can_manage_catalog());

commit;
