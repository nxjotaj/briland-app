begin;

create unique index if not exists "User_email_lower_key"
  on public."User" (lower(email));

create or replace function public.request_user_registration(
  p_name text,
  p_company text,
  p_phone text,
  p_email text,
  p_cnpj text,
  p_observacoes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if trim(coalesce(p_name, '')) = ''
    or trim(coalesce(p_company, '')) = ''
    or trim(coalesce(p_phone, '')) = ''
    or v_email = ''
    or trim(coalesce(p_cnpj, '')) = '' then
    raise exception 'Preencha todos os campos obrigatorios.';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Informe um e-mail valido.';
  end if;

  -- Retorna a mesma resposta para e-mails novos e existentes, evitando
  -- cadastros duplicados sem revelar publicamente quem ja possui conta.
  if exists (select 1 from public."User" where lower(email) = v_email) then
    return jsonb_build_object('accepted', true);
  end if;

  insert into public."User" (
    id, name, company, email, "passwordHash", role, status, phone, cnpj,
    "registrationNotes", notes, "updatedAt", "authUserId"
  ) values (
    'user_' || replace(gen_random_uuid()::text, '-', ''),
    trim(p_name),
    trim(p_company),
    v_email,
    'PENDING_APPROVAL',
    'CLIENTE'::public."UserRole",
    'PENDING'::public."UserStatus",
    trim(p_phone),
    trim(p_cnpj),
    nullif(trim(coalesce(p_observacoes, '')), ''),
    'Cadastro pendente pelo app.',
    now(),
    null
  );

  return jsonb_build_object('accepted', true);
exception
  when unique_violation then
    return jsonb_build_object('accepted', true);
end;
$$;

revoke all on function public.request_user_registration(text, text, text, text, text, text) from public;
grant execute on function public.request_user_registration(text, text, text, text, text, text) to anon, authenticated;

commit;
