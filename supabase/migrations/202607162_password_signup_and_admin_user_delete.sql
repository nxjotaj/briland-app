begin;

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
  if v_source <> 'briland_catalog' then
    return new;
  end if;

  if v_name = '' or v_company = '' or v_phone = '' or v_cnpj = '' or coalesce(new.email, '') = '' then
    raise exception 'Dados obrigatorios do cadastro incompletos.';
  end if;

  select *
  into v_existing
  from public."User"
  where lower(email) = lower(new.email)
  limit 1
  for update;

  if found then
    if v_existing.status <> 'PENDING'::public."UserStatus" or v_existing."authUserId" is not null then
      raise exception 'Este e-mail ja possui cadastro.';
    end if;

    update public."User"
    set name = v_name,
        company = v_company,
        phone = v_phone,
        cnpj = v_cnpj,
        "registrationNotes" = nullif(v_observacoes, ''),
        "passwordHash" = 'SUPABASE_AUTH',
        "authUserId" = new.id,
        "updatedAt" = now()
    where id = v_existing.id;
  else
    insert into public."User" (
      id, name, company, email, "passwordHash", role, status, phone, cnpj,
      "registrationNotes", notes, "updatedAt", "authUserId"
    ) values (
      'user_' || replace(gen_random_uuid()::text, '-', ''),
      v_name,
      v_company,
      lower(new.email),
      'SUPABASE_AUTH',
      'CLIENTE'::public."UserRole",
      'PENDING'::public."UserStatus",
      v_phone,
      v_cnpj,
      nullif(v_observacoes, ''),
      'Cadastro pendente pelo app.',
      now(),
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists "briland_registration_auth_user" on auth.users;
create trigger "briland_registration_auth_user"
after insert on auth.users
for each row execute function public.handle_briland_registration_auth_user();

create or replace function public.admin_delete_user(p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_user_id uuid;
begin
  if not public.is_admin_master() then
    raise exception 'Apenas o administrador master pode excluir usuarios.';
  end if;

  select "authUserId"
  into v_auth_user_id
  from public."User"
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('deleted', true);
  end if;

  if v_auth_user_id = auth.uid() then
    raise exception 'Nao e permitido excluir o proprio usuario administrador.';
  end if;

  delete from public."AppTelemetryEvent" where "userId" = p_user_id;
  delete from public."User" where id = p_user_id;

  if v_auth_user_id is not null then
    delete from auth.users where id = v_auth_user_id;
  end if;

  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.admin_delete_user(text) from public;
grant execute on function public.admin_delete_user(text) to authenticated;

commit;
