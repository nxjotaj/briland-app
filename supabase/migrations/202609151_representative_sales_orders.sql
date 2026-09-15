begin;

alter table public."User" add column if not exists "zipCode" text null;
alter table public."User" add column if not exists neighborhood text null;
alter table public."User" add column if not exists "orderDiscountLimit" numeric(5,2) not null default 15 check ("orderDiscountLimit" between 0 and 100);

create sequence if not exists public.sales_order_number_seq start 1;

create table if not exists public."SalesOrder" (
  id text primary key default ('order_' || gen_random_uuid()::text),
  "orderNumber" bigint not null unique default nextval('public.sales_order_number_seq'),
  "representativeId" text not null references public."User"(id) on delete restrict,
  "clientId" text null references public."User"(id) on delete restrict,
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','CANCELLED')),
  "freightType" text null check ("freightType" in ('CIF','FOB')),
  "redispatchName" text null,
  "redispatchPhone" text null,
  "paymentType" text null check ("paymentType" in ('UPFRONT','INSTALLMENTS')),
  "paymentTerms" text null,
  notes text null,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  "clientSnapshot" jsonb not null default '{}'::jsonb,
  "representativeSnapshot" jsonb not null default '{}'::jsonb,
  "expiresAt" timestamptz not null default (now() + interval '3 days'),
  "submittedAt" timestamptz null,
  "approvedAt" timestamptz null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public."SalesOrderItem" (
  id text primary key default ('order_item_' || gen_random_uuid()::text),
  "orderId" text not null references public."SalesOrder"(id) on delete cascade,
  "productId" text not null references public."Produto"(id) on delete restrict,
  "productCode" text not null,
  "productName" text not null,
  quantity integer not null check (quantity > 0),
  "listPrice" numeric(14,2) not null check ("listPrice" >= 0),
  "manualDiscountPercent" numeric(5,2) not null default 0 check ("manualDiscountPercent" between 0 and 100),
  "paymentDiscountPercent" numeric(5,2) not null default 0 check ("paymentDiscountPercent" between 0 and 100),
  "effectiveDiscountPercent" numeric(5,2) not null default 0 check ("effectiveDiscountPercent" between 0 and 100),
  "unitPrice" numeric(14,2) not null check ("unitPrice" >= 0),
  "lineTotal" numeric(14,2) not null check ("lineTotal" >= 0),
  "sortOrder" integer not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("orderId", "productId")
);

create table if not exists public."SalesOrderHistory" (
  id text primary key default ('order_history_' || gen_random_uuid()::text),
  "orderId" text not null references public."SalesOrder"(id) on delete cascade,
  action text not null,
  comment text null,
  "actorUserId" text null references public."User"(id) on delete set null,
  "actorName" text null,
  metadata jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now()
);

create table if not exists public."StockReservation" (
  id text primary key default ('reservation_' || gen_random_uuid()::text),
  "orderId" text not null references public."SalesOrder"(id) on delete cascade,
  "productId" text not null references public."Produto"(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','RELEASED','CONSUMED')),
  "releasedAt" timestamptz null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("orderId", "productId")
);

create index if not exists "SalesOrder_representative_created_idx" on public."SalesOrder" ("representativeId", "createdAt" desc);
create index if not exists "SalesOrder_status_submitted_idx" on public."SalesOrder" (status, "submittedAt");
create index if not exists "SalesOrderItem_order_idx" on public."SalesOrderItem" ("orderId", "sortOrder");
create index if not exists "SalesOrderHistory_order_idx" on public."SalesOrderHistory" ("orderId", "createdAt");
create index if not exists "StockReservation_product_active_idx" on public."StockReservation" ("productId") where status = 'ACTIVE';

do $$ begin alter publication supabase_realtime add table public."SalesOrder"; exception when duplicate_object then null; end $$;

create or replace function public.current_app_user()
returns public."User"
language sql stable security definer set search_path=public
as $$ select u from public."User" u where u."authUserId"=auth.uid() and u.status='ACTIVE' limit 1 $$;

create or replace function public.is_sales_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select public.current_app_role() in ('ADMIN','ADMIN_MASTER','ADMIN_COLABORADOR') $$;

create or replace function public.can_access_sales_order(p_order_id text)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_sales_admin() or exists(
    select 1 from public."SalesOrder" o
    join public."User" u on u."authUserId"=auth.uid() and u.status='ACTIVE'
    where o.id=p_order_id and (o."representativeId"=u.id or o."clientId"=u.id)
  )
$$;

create or replace function public.expire_abandoned_sales_order_drafts()
returns integer language plpgsql security definer set search_path=public
as $$
declare affected integer;
begin
  update public."SalesOrder" set status='CANCELLED',"updatedAt"=now()
  where status='DRAFT' and "expiresAt" <= now();
  get diagnostics affected=row_count;
  insert into public."SalesOrderHistory"("orderId",action,comment,metadata)
  select id,'AUTO_CANCELLED','Rascunho expirado após três dias.','{"reason":"draft_expired"}'::jsonb
  from public."SalesOrder" o
  where o.status='CANCELLED' and o."updatedAt">=now()-interval '2 seconds'
    and not exists(select 1 from public."SalesOrderHistory" h where h."orderId"=o.id and h.action='AUTO_CANCELLED');
  return affected;
end $$;

create or replace function public.open_sales_order_draft()
returns public."SalesOrder" language plpgsql security definer set search_path=public
as $$
declare actor public."User"; result public."SalesOrder";
begin
  perform public.expire_abandoned_sales_order_drafts();
  select * into actor from public.current_app_user();
  if actor.id is null or actor.role::text <> 'REPRESENTANTE' then raise exception using errcode='42501',message='Somente representantes ativos podem abrir pedidos.'; end if;
  insert into public."SalesOrder"("representativeId","representativeSnapshot")
  values(actor.id,jsonb_build_object('id',actor.id,'name',actor.name,'email',actor.email,'phone',actor.phone,'company',actor.company)) returning * into result;
  insert into public."SalesOrderHistory"("orderId",action,"actorUserId","actorName") values(result.id,'CREATED',actor.id,actor.name);
  return result;
end $$;

create or replace function public.release_sales_order_reservations(p_order_id text, p_status text default 'RELEASED')
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public."StockReservation" set status=p_status,"releasedAt"=now(),"updatedAt"=now()
  where "orderId"=p_order_id and status='ACTIVE';
end $$;

create or replace function public.save_sales_order(
  p_order_id text, p_client_id text, p_freight_type text, p_redispatch_name text,
  p_redispatch_phone text, p_payment_type text, p_payment_terms text, p_notes text,
  p_items jsonb, p_submit boolean default false
)
returns public."SalesOrder" language plpgsql security definer set search_path=public
as $$
declare actor public."User"; order_row public."SalesOrder"; client_row public."User"; product_row public."Produto";
  item jsonb; manual_discount numeric; payment_discount numeric; effective_discount numeric; qty integer;
  line_list numeric; line_total numeric; sum_list numeric:=0; sum_total numeric:=0; reserved integer; idx integer:=0;
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
    effective_discount:=least(100,manual_discount+payment_discount);
    line_list:=round(product_row.preco*qty,2); line_total:=round(product_row.preco*(1-effective_discount/100)*qty,2);
    insert into public."SalesOrderItem"("orderId","productId","productCode","productName",quantity,"listPrice","manualDiscountPercent","paymentDiscountPercent","effectiveDiscountPercent","unitPrice","lineTotal","sortOrder")
    values(p_order_id,product_row.id,coalesce(product_row."codigoInterno",product_row.id),product_row.nome,qty,product_row.preco,manual_discount,payment_discount,effective_discount,round(product_row.preco*(1-effective_discount/100),2),line_total,idx);
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

create or replace function public.request_sales_order_change(p_order_id text,p_comment text)
returns void language plpgsql security definer set search_path=public
as $$ declare actor public."User"; begin
  select * into actor from public.current_app_user();
  if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Descreva a alteração solicitada.'; end if;
  if not exists(select 1 from public."SalesOrder" where id=p_order_id and "representativeId"=actor.id and status='SUBMITTED') then raise exception using errcode='42501',message='Este pedido não aceita solicitação de alteração.'; end if;
  insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName") values(p_order_id,'CHANGE_REQUESTED',btrim(p_comment),actor.id,actor.name);
end $$;

create or replace function public.transition_sales_order(p_order_id text,p_action text,p_comment text default null)
returns public."SalesOrder" language plpgsql security definer set search_path=public
as $$
declare actor public."User"; o public."SalesOrder"; target text; item record; product_row public."Produto"; batch_id text; current_balance integer; result public."SalesOrder";
begin
  select * into actor from public.current_app_user(); select * into o from public."SalesOrder" where id=p_order_id for update;
  if o.id is null then raise exception 'Pedido não encontrado.'; end if;
  if upper(p_action)='CANCEL' and actor.role::text='REPRESENTANTE' and o."representativeId"=actor.id and o.status in ('DRAFT','RETURNED') then target:='CANCELLED';
  elsif public.is_sales_admin() and o.status='SUBMITTED' and upper(p_action) in ('RETURN','REJECT','APPROVE') then target:=case upper(p_action) when 'RETURN' then 'RETURNED' when 'REJECT' then 'REJECTED' else 'APPROVED' end;
  else raise exception using errcode='42501',message='Transição de pedido não permitida.'; end if;
  if target in ('RETURNED','REJECTED','CANCELLED') then perform public.release_sales_order_reservations(p_order_id); end if;
  if target='APPROVED' then
    batch_id:='stock_batch_'||gen_random_uuid()::text;
    insert into public."StockBatch"(id,direction,status,source,reason,"createdBy","appliedAt") values(batch_id,'SAIDA','APLICADO','MANUAL','Pedido '||lpad(o."orderNumber"::text,6,'0'),actor.id,now());
    for item in select i.*,r.quantity reserved_quantity from public."SalesOrderItem" i join public."StockReservation" r on r."orderId"=i."orderId" and r."productId"=i."productId" and r.status='ACTIVE' where i."orderId"=p_order_id order by i."sortOrder" loop
      select * into product_row from public."Produto" where id=item."productId" for update; current_balance:=coalesce(product_row.estoque,0);
      if current_balance<item.reserved_quantity then raise exception 'Saldo físico insuficiente para aprovar o produto %.',item."productCode"; end if;
      update public."Produto" set estoque=current_balance-item.reserved_quantity,"updatedAt"=now() where id=product_row.id;
      insert into public."StockMovement"("batchId","productId",kind,quantity,"previousBalance","newBalance",reason,"createdBy") values(batch_id,product_row.id,'SAIDA',-item.reserved_quantity,current_balance,current_balance-item.reserved_quantity,'Pedido '||lpad(o."orderNumber"::text,6,'0'),actor.id);
    end loop;
    perform public.release_sales_order_reservations(p_order_id,'CONSUMED');
  end if;
  update public."SalesOrder" set status=target,"approvedAt"=case when target='APPROVED' then now() else "approvedAt" end,"updatedAt"=now() where id=p_order_id returning * into result;
  insert into public."SalesOrderHistory"("orderId",action,comment,"actorUserId","actorName") values(p_order_id,target,nullif(btrim(coalesce(p_comment,'')),''),actor.id,actor.name);
  return result;
end $$;

create or replace function public.get_sales_stock()
returns table("productId" text,"productCode" text,"productName" text,"physicalBalance" integer,"reservedBalance" integer,"availableBalance" integer,"listPrice" numeric)
language sql stable security definer set search_path=public
as $$
 select p.id,p."codigoInterno",p.nome,coalesce(p.estoque,0),coalesce(sum(r.quantity) filter(where r.status='ACTIVE'),0)::integer,
   coalesce(p.estoque,0)-coalesce(sum(r.quantity) filter(where r.status='ACTIVE'),0)::integer,p.preco
 from public."Produto" p left join public."StockReservation" r on r."productId"=p.id
 where p.ativo=true and (public.current_app_role()='REPRESENTANTE' or public.is_sales_admin())
 group by p.id,p."codigoInterno",p.nome,p.estoque,p.preco order by p.nome;
$$;

create or replace function public.update_representative_client(p_client_id text,p_payload jsonb)
returns public."User" language plpgsql security definer set search_path=public
as $$ declare actor public."User"; result public."User"; old_data jsonb; begin
 select * into actor from public.current_app_user();
 select to_jsonb(u) into old_data from public."User" u where u.id=p_client_id and u.role='CLIENTE' and u."representanteId"=actor.id for update;
 if old_data is null or actor.role::text<>'REPRESENTANTE' then raise exception using errcode='42501',message='Cliente não disponível.'; end if;
 update public."User" set name=btrim(p_payload->>'name'),company=btrim(p_payload->>'company'),phone=btrim(p_payload->>'phone'),cnpj=btrim(p_payload->>'cnpj'),address=btrim(p_payload->>'address'),"zipCode"=btrim(p_payload->>'zipCode'),neighborhood=btrim(p_payload->>'neighborhood'),city=btrim(p_payload->>'city'),state=upper(btrim(p_payload->>'state')),"updatedAt"=now()
 where id=p_client_id returning * into result;
 insert into public."AuditLog"(id,"actorUserId","actorEmail",action,"entityType","entityId",metadata) values('audit_'||gen_random_uuid()::text,actor.id,actor.email,'UPDATE','User',p_client_id,jsonb_build_object('before',old_data,'after',to_jsonb(result)));
 return result;
end $$;

create or replace function public.create_representative_client(p_payload jsonb)
returns public."User" language plpgsql security definer set search_path=public
as $$
declare actor public."User"; result public."User"; normalized_email text:=lower(btrim(p_payload->>'email')); key text;
begin
  select * into actor from public.current_app_user();
  if actor.id is null or actor.role::text<>'REPRESENTANTE' then raise exception using errcode='42501',message='Somente representantes ativos podem cadastrar clientes.'; end if;
  foreach key in array array['name','company','cnpj','address','zipCode','neighborhood','city','state','email','phone'] loop
    if nullif(btrim(p_payload->>key),'') is null then raise exception 'Preencha todos os dados obrigatórios do cliente.'; end if;
  end loop;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Informe um e-mail válido.'; end if;
  if exists(select 1 from public."User" where lower(email)=normalized_email) then raise exception 'Este e-mail já possui cadastro.'; end if;
  insert into public."User"(id,name,company,email,"passwordHash",role,status,phone,cnpj,address,"zipCode",neighborhood,city,state,"representanteId",notes,"updatedAt")
  values('user_'||replace(gen_random_uuid()::text,'-',''),btrim(p_payload->>'name'),btrim(p_payload->>'company'),normalized_email,'FIRST_ACCESS_PENDING','CLIENTE','ACTIVE',btrim(p_payload->>'phone'),btrim(p_payload->>'cnpj'),btrim(p_payload->>'address'),btrim(p_payload->>'zipCode'),btrim(p_payload->>'neighborhood'),btrim(p_payload->>'city'),upper(btrim(p_payload->>'state')),actor.id,'Cadastrado pelo representante '||actor.name||'.',now()) returning * into result;
  insert into public."AuditLog"(id,"actorUserId","actorEmail",action,"entityType","entityId",metadata) values('audit_'||gen_random_uuid()::text,actor.id,actor.email,'CREATE','User',result.id,jsonb_build_object('source','REPRESENTATIVE_PORTAL'));
  return result;
end $$;

create or replace function public.is_client_first_access(p_email text)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public."User" where lower(email)=lower(btrim(p_email)) and status='ACTIVE' and role='CLIENTE' and "passwordHash"='FIRST_ACCESS_PENDING') $$;

create or replace function public.handle_briland_registration_auth_user()
returns trigger language plpgsql security definer set search_path=public,auth
as $$
declare v_source text:=coalesce(new.raw_user_meta_data->>'registration_source',''); v_existing public."User"%rowtype;
  v_name text:=trim(coalesce(new.raw_user_meta_data->>'name','')); v_company text:=trim(coalesce(new.raw_user_meta_data->>'company',''));
  v_phone text:=trim(coalesce(new.raw_user_meta_data->>'phone','')); v_cnpj text:=trim(coalesce(new.raw_user_meta_data->>'cnpj','')); v_observacoes text:=trim(coalesce(new.raw_user_meta_data->>'observacoes',''));
begin
  if v_source='representative_first_access' then
    select * into v_existing from public."User" where lower(email)=lower(new.email) limit 1 for update;
    if not found or v_existing.status<>'ACTIVE' or v_existing.role<>'CLIENTE' or v_existing."authUserId" is not null or v_existing."passwordHash"<>'FIRST_ACCESS_PENDING' then raise exception 'Cadastro de primeiro acesso não encontrado.'; end if;
    update public."User" set "authUserId"=new.id,"updatedAt"=now() where id=v_existing.id;
    return new;
  end if;
  if v_source<>'briland_catalog' then return new; end if;
  if v_name='' or v_company='' or v_phone='' or v_cnpj='' or coalesce(new.email,'')='' then raise exception 'Dados obrigatórios do cadastro incompletos.'; end if;
  select * into v_existing from public."User" where lower(email)=lower(new.email) limit 1 for update;
  if found then
    if v_existing.status<>'PENDING' or v_existing."authUserId" is not null then raise exception 'Este e-mail já possui cadastro.'; end if;
    update public."User" set name=v_name,company=v_company,phone=v_phone,cnpj=v_cnpj,"registrationNotes"=nullif(v_observacoes,''),"passwordHash"='SUPABASE_AUTH',"authUserId"=new.id,role='NAO_CLIENTE',status='ACTIVE',notes='Novo cadastro confirmado por e-mail; aguardando classificação comercial.',"updatedAt"=now() where id=v_existing.id;
  else
    insert into public."User"(id,name,company,email,"passwordHash",role,status,phone,cnpj,"registrationNotes",notes,"updatedAt","authUserId") values('user_'||replace(gen_random_uuid()::text,'-',''),v_name,v_company,lower(new.email),'SUPABASE_AUTH','NAO_CLIENTE','ACTIVE',v_phone,v_cnpj,nullif(v_observacoes,''),'Novo cadastro confirmado por e-mail; aguardando classificação comercial.',now(),new.id);
  end if;
  return new;
end $$;

create or replace function public.complete_client_first_access()
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public."User" set "passwordHash"='SUPABASE_AUTH',"updatedAt"=now()
  where "authUserId"=auth.uid() and status='ACTIVE' and "passwordHash"='FIRST_ACCESS_PENDING';
  if not found then raise exception 'Cadastro de primeiro acesso não encontrado.'; end if;
end $$;

alter table public."SalesOrder" enable row level security;
alter table public."SalesOrderItem" enable row level security;
alter table public."SalesOrderHistory" enable row level security;
alter table public."StockReservation" enable row level security;

create policy "sales order scoped read" on public."SalesOrder" for select to authenticated using(public.can_access_sales_order(id));
create policy "sales item scoped read" on public."SalesOrderItem" for select to authenticated using(public.can_access_sales_order("orderId"));
create policy "sales history scoped read" on public."SalesOrderHistory" for select to authenticated using(public.can_access_sales_order("orderId"));
create policy "sales reservation scoped read" on public."StockReservation" for select to authenticated using(public.can_access_sales_order("orderId"));
create policy "representative reads linked clients" on public."User" for select to authenticated using(
  "representanteId"=(select id from public."User" where "authUserId"=auth.uid() and role='REPRESENTANTE' and status='ACTIVE' limit 1)
);

revoke all on function public.open_sales_order_draft() from public;
revoke all on function public.expire_abandoned_sales_order_drafts() from public;
revoke all on function public.save_sales_order(text,text,text,text,text,text,text,text,jsonb,boolean) from public;
revoke all on function public.request_sales_order_change(text,text) from public;
revoke all on function public.transition_sales_order(text,text,text) from public;
revoke all on function public.get_sales_stock() from public;
revoke all on function public.update_representative_client(text,jsonb) from public;
revoke all on function public.create_representative_client(jsonb) from public;
revoke all on function public.is_client_first_access(text) from public;
revoke all on function public.complete_client_first_access() from public;
grant execute on function public.open_sales_order_draft() to authenticated;
grant execute on function public.expire_abandoned_sales_order_drafts() to authenticated;
grant execute on function public.save_sales_order(text,text,text,text,text,text,text,text,jsonb,boolean) to authenticated;
grant execute on function public.request_sales_order_change(text,text) to authenticated;
grant execute on function public.transition_sales_order(text,text,text) to authenticated;
grant execute on function public.get_sales_stock() to authenticated;
grant execute on function public.update_representative_client(text,jsonb) to authenticated;
grant execute on function public.create_representative_client(jsonb) to authenticated;
grant execute on function public.is_client_first_access(text) to anon,authenticated;
grant execute on function public.complete_client_first_access() to authenticated;
grant select on public."SalesOrder",public."SalesOrderItem",public."SalesOrderHistory",public."StockReservation" to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sales-orders','sales-orders',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "sales order pdf scoped read" on storage.objects for select to authenticated using(bucket_id='sales-orders' and public.can_access_sales_order((storage.foldername(name))[1]));
create policy "sales order pdf scoped insert" on storage.objects for insert to authenticated with check(bucket_id='sales-orders' and public.can_access_sales_order((storage.foldername(name))[1]));
create policy "sales order pdf scoped update" on storage.objects for update to authenticated using(bucket_id='sales-orders' and public.can_access_sales_order((storage.foldername(name))[1])) with check(bucket_id='sales-orders' and public.can_access_sales_order((storage.foldername(name))[1]));

commit;
