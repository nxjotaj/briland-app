-- Novos cadastros deixam de depender de aprovação manual.
-- O Supabase continua impedindo o login até a confirmação real do e-mail.
create or replace function public.handle_briland_registration_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_source text := coalesce(new.raw_user_meta_data ->> 'registration_source', '');
  v_name text := trim(coalesce(new.raw_user_meta_data ->> 'name', ''));
  v_company text := trim(coalesce(new.raw_user_meta_data ->> 'company', ''));
  v_phone text := trim(coalesce(new.raw_user_meta_data ->> 'phone', ''));
  v_cnpj text := trim(coalesce(new.raw_user_meta_data ->> 'cnpj', ''));
  v_observacoes text := trim(coalesce(new.raw_user_meta_data ->> 'observacoes', ''));
  v_existing public."User"%rowtype;
begin
  if v_source <> 'briland_catalog' then return new; end if;
  if v_name = '' or v_company = '' or v_phone = '' or v_cnpj = '' or coalesce(new.email, '') = '' then
    raise exception 'Dados obrigatorios do cadastro incompletos.';
  end if;
  select * into v_existing from public."User"
   where lower(email) = lower(new.email) limit 1 for update;
  if found then
    if v_existing.status <> 'PENDING'::public."UserStatus" or v_existing."authUserId" is not null then
      raise exception 'Este e-mail ja possui cadastro.';
    end if;
    update public."User"
       set name = v_name, company = v_company, phone = v_phone, cnpj = v_cnpj,
           "registrationNotes" = nullif(v_observacoes, ''), "passwordHash" = 'SUPABASE_AUTH',
           "authUserId" = new.id, role = 'NAO_CLIENTE'::public."UserRole",
           status = 'ACTIVE'::public."UserStatus",
           notes = 'Novo cadastro confirmado por e-mail; aguardando classificação comercial.',
           "updatedAt" = now()
     where id = v_existing.id;
  else
    insert into public."User" (
      id, name, company, email, "passwordHash", role, status, phone, cnpj,
      "registrationNotes", notes, "updatedAt", "authUserId"
    ) values (
      'user_' || replace(gen_random_uuid()::text, '-', ''), v_name, v_company, lower(new.email),
      'SUPABASE_AUTH', 'NAO_CLIENTE'::public."UserRole", 'ACTIVE'::public."UserStatus",
      v_phone, v_cnpj, nullif(v_observacoes, ''),
      'Novo cadastro confirmado por e-mail; aguardando classificação comercial.', now(), new.id
    );
  end if;
  return new;
end;
$$;

comment on function public.handle_briland_registration_auth_user() is
  'Cria novos usuários como NAO_CLIENTE e ACTIVE; a confirmação de e-mail do Supabase permanece obrigatória para autenticação.';
