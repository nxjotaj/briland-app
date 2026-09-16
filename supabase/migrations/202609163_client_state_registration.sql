alter table public."User"
  add column if not exists "stateRegistration" text null;

create or replace function public.update_representative_client(p_client_id text,p_payload jsonb)
returns public."User" language plpgsql security definer set search_path=public
as $$ declare actor public."User"; result public."User"; old_data jsonb; begin
 select * into actor from public.current_app_user();
 select to_jsonb(u) into old_data from public."User" u where u.id=p_client_id and u.role='CLIENTE' and u."representanteId"=actor.id for update;
 if old_data is null or actor.role::text<>'REPRESENTANTE' then raise exception using errcode='42501',message='Cliente não disponível.'; end if;
 if nullif(btrim(p_payload->>'stateRegistration'),'') is null then raise exception 'Informe a inscrição estadual do cliente.'; end if;
 update public."User" set name=btrim(p_payload->>'name'),company=btrim(p_payload->>'company'),phone=btrim(p_payload->>'phone'),cnpj=btrim(p_payload->>'cnpj'),"stateRegistration"=upper(btrim(p_payload->>'stateRegistration')),address=btrim(p_payload->>'address'),"zipCode"=btrim(p_payload->>'zipCode'),neighborhood=btrim(p_payload->>'neighborhood'),city=btrim(p_payload->>'city'),state=upper(btrim(p_payload->>'state')),"updatedAt"=now()
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
  foreach key in array array['name','company','cnpj','stateRegistration','address','zipCode','neighborhood','city','state','email','phone'] loop
    if nullif(btrim(p_payload->>key),'') is null then raise exception 'Preencha todos os dados obrigatórios do cliente.'; end if;
  end loop;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Informe um e-mail válido.'; end if;
  if exists(select 1 from public."User" where lower(email)=normalized_email) then raise exception 'Este e-mail já possui cadastro.'; end if;
  insert into public."User"(id,name,company,email,"passwordHash",role,status,phone,cnpj,"stateRegistration",address,"zipCode",neighborhood,city,state,"representanteId",notes,"updatedAt")
  values('user_'||replace(gen_random_uuid()::text,'-',''),btrim(p_payload->>'name'),btrim(p_payload->>'company'),normalized_email,'FIRST_ACCESS_PENDING','CLIENTE','ACTIVE',btrim(p_payload->>'phone'),btrim(p_payload->>'cnpj'),upper(btrim(p_payload->>'stateRegistration')),btrim(p_payload->>'address'),btrim(p_payload->>'zipCode'),btrim(p_payload->>'neighborhood'),btrim(p_payload->>'city'),upper(btrim(p_payload->>'state')),actor.id,'Cadastrado pelo representante '||actor.name||'.',now()) returning * into result;
  insert into public."AuditLog"(id,"actorUserId","actorEmail",action,"entityType","entityId",metadata) values('audit_'||gen_random_uuid()::text,actor.id,actor.email,'CREATE','User',result.id,jsonb_build_object('source','REPRESENTATIVE_PORTAL'));
  return result;
end $$;

create or replace function public.enrich_sales_order_client_snapshot()
returns trigger language plpgsql security definer set search_path=public
as $$
declare client_registration text;
begin
  if new."clientId" is not null then
    select "stateRegistration" into client_registration from public."User" where id=new."clientId";
    new."clientSnapshot"=coalesce(new."clientSnapshot",'{}'::jsonb)||jsonb_build_object('stateRegistration',client_registration);
  end if;
  return new;
end $$;

drop trigger if exists "sales_order_client_snapshot_registration" on public."SalesOrder";
create trigger "sales_order_client_snapshot_registration"
before insert or update of "clientId","clientSnapshot" on public."SalesOrder"
for each row execute function public.enrich_sales_order_client_snapshot();

update public."SalesOrder" o
set "clientSnapshot"=coalesce(o."clientSnapshot",'{}'::jsonb)||jsonb_build_object('stateRegistration',u."stateRegistration")
from public."User" u
where u.id=o."clientId";

revoke all on function public.update_representative_client(text,jsonb) from public;
revoke all on function public.create_representative_client(jsonb) from public;
grant execute on function public.update_representative_client(text,jsonb) to authenticated;
grant execute on function public.create_representative_client(jsonb) to authenticated;

