alter table public."User"
  add column if not exists "privacyAcceptedAt" timestamptz,
  add column if not exists "privacyPolicyVersion" text,
  add column if not exists "privacyConsentSource" text;

create or replace function public.handle_briland_registration_auth_user()
returns trigger language plpgsql security definer set search_path=public,auth
as $$
declare
  v_source text:=coalesce(new.raw_user_meta_data->>'registration_source','');
  v_existing public."User"%rowtype;
  v_name text:=trim(coalesce(new.raw_user_meta_data->>'name',''));
  v_company text:=trim(coalesce(new.raw_user_meta_data->>'company',''));
  v_phone text:=trim(coalesce(new.raw_user_meta_data->>'phone',''));
  v_cnpj text:=trim(coalesce(new.raw_user_meta_data->>'cnpj',''));
  v_observacoes text:=trim(coalesce(new.raw_user_meta_data->>'observacoes',''));
  v_privacy_accepted_at timestamptz;
  v_privacy_policy_version text:=trim(coalesce(new.raw_user_meta_data->>'privacy_policy_version',''));
  v_privacy_consent_source text:=trim(coalesce(new.raw_user_meta_data->>'privacy_consent_source',''));
begin
  if v_source='representative_first_access' then
    select * into v_existing from public."User" where lower(email)=lower(new.email) limit 1 for update;
    if not found or v_existing.status<>'ACTIVE' or v_existing.role<>'CLIENTE' or v_existing."authUserId" is not null or v_existing."passwordHash"<>'FIRST_ACCESS_PENDING' then raise exception 'Cadastro de primeiro acesso não encontrado.'; end if;
    update public."User" set "authUserId"=new.id,"updatedAt"=now() where id=v_existing.id;
    return new;
  end if;
  if v_source<>'briland_catalog' then return new; end if;
  begin v_privacy_accepted_at:=(new.raw_user_meta_data->>'privacy_accepted_at')::timestamptz; exception when others then v_privacy_accepted_at:=null; end;
  if v_name='' or v_company='' or v_phone='' or v_cnpj='' or coalesce(new.email,'')='' then raise exception 'Dados obrigatórios do cadastro incompletos.'; end if;
  select * into v_existing from public."User" where lower(email)=lower(new.email) limit 1 for update;
  if found then
    if v_existing.status<>'PENDING' or v_existing."authUserId" is not null then raise exception 'Este e-mail já possui cadastro.'; end if;
    update public."User" set name=v_name,company=v_company,phone=v_phone,cnpj=v_cnpj,"registrationNotes"=nullif(v_observacoes,''),"passwordHash"='SUPABASE_AUTH',"authUserId"=new.id,role='NAO_CLIENTE',status='ACTIVE',notes='Novo cadastro confirmado por e-mail; aguardando classificação comercial.',"privacyAcceptedAt"=v_privacy_accepted_at,"privacyPolicyVersion"=nullif(v_privacy_policy_version,''),"privacyConsentSource"=nullif(v_privacy_consent_source,''),"updatedAt"=now() where id=v_existing.id;
  else
    insert into public."User"(id,name,company,email,"passwordHash",role,status,phone,cnpj,"registrationNotes",notes,"updatedAt","authUserId","privacyAcceptedAt","privacyPolicyVersion","privacyConsentSource") values('user_'||replace(gen_random_uuid()::text,'-',''),v_name,v_company,lower(new.email),'SUPABASE_AUTH','NAO_CLIENTE','ACTIVE',v_phone,v_cnpj,nullif(v_observacoes,''),'Novo cadastro confirmado por e-mail; aguardando classificação comercial.',now(),new.id,v_privacy_accepted_at,nullif(v_privacy_policy_version,''),nullif(v_privacy_consent_source,''));
  end if;
  return new;
end $$;

comment on column public."User"."privacyAcceptedAt" is 'Data e hora informada pelo cliente ao aceitar a politica de privacidade no cadastro.';
comment on column public."User"."privacyPolicyVersion" is 'Versao da politica aceita no cadastro.';
comment on column public."User"."privacyConsentSource" is 'Aplicativo ou interface em que o consentimento foi registrado.';
