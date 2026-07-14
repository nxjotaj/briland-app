begin;

create or replace function public.request_account_deletion(
  p_email text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user public."User"%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_reason text := left(trim(coalesce(p_reason, 'Não informado.')), 1000);
begin
  if auth.uid() is not null then
    select * into v_user
    from public."User"
    where "authUserId" = auth.uid()
    limit 1;

    if found then
      v_email := lower(v_user.email);
    end if;
  elsif v_email <> '' then
    select * into v_user
    from public."User"
    where lower(email) = v_email
    limit 1;
  end if;

  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Informe um e-mail válido para solicitar a exclusão.';
  end if;

  if exists (
    select 1
    from public."LeadOrcamento"
    where origem = 'account-deletion'
      and lower(coalesce(email, '')) = v_email
      and status in ('NOVO'::public."LeadStatus", 'EM_ATENDIMENTO'::public."LeadStatus")
  ) then
    return jsonb_build_object('accepted', true, 'message', 'Solicitação já registrada.');
  end if;

  -- Only an authenticated owner can immediately deactivate the matching account.
  -- Public requests are recorded for identity verification by the privacy team.
  if v_user.id is not null and auth.uid() is not null then
    update public."User"
    set status = 'INACTIVE'::public."UserStatus",
        "updatedAt" = now()
    where id = v_user.id;
  end if;

  insert into public."LeadOrcamento" (
    id,
    nome,
    empresa,
    telefone,
    email,
    cidade,
    estado,
    "produtoId",
    mensagem,
    origem,
    status
  ) values (
    'privacy_' || replace(gen_random_uuid()::text, '-', ''),
    coalesce(nullif(v_user.name, ''), 'Solicitação de privacidade'),
    nullif(v_user.company, ''),
    coalesce(nullif(v_user.phone, ''), 'Não informado'),
    v_email,
    nullif(v_user.city, ''),
    nullif(v_user.state, ''),
    null,
    '[Privacidade] Solicitação de exclusão de conta e dados. Motivo: ' || v_reason,
    'account-deletion',
    'NOVO'::public."LeadStatus"
  );

  return jsonb_build_object(
    'accepted', true,
    'message', 'Solicitação registrada. A conclusão ocorrerá em até 30 dias.'
  );
end;
$$;

revoke all on function public.request_account_deletion(text, text) from public;
grant execute on function public.request_account_deletion(text, text) to anon, authenticated;

create or replace function public.complete_account_deletion(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user_id text;
  v_auth_user_id uuid;
begin
  if not public.is_admin_master() then
    raise exception 'Apenas o administrador master pode concluir exclusões de conta.';
  end if;

  if v_email = '' then
    raise exception 'E-mail obrigatório.';
  end if;

  select id, "authUserId"
  into v_user_id, v_auth_user_id
  from public."User"
  where lower(email) = v_email
  limit 1;

  if v_user_id is not null then
    delete from public."AppTelemetryEvent" where "userId" = v_user_id;
    delete from public."LeadOrcamento"
    where lower(coalesce(email, '')) = v_email
      and coalesce(origem, '') <> 'account-deletion';
    delete from public."User" where id = v_user_id;
  end if;

  if v_auth_user_id is not null then
    delete from auth.users where id = v_auth_user_id;
  end if;

  update public."LeadOrcamento"
  set nome = 'Solicitação de privacidade concluída',
      empresa = null,
      telefone = 'Removido',
      email = null,
      cidade = null,
      estado = null,
      mensagem = '[Privacidade] Conta e dados associados excluídos.',
      status = 'CONCLUIDO'::public."LeadStatus"
  where origem = 'account-deletion'
    and lower(coalesce(email, '')) = v_email;

  return jsonb_build_object('completed', true);
end;
$$;

revoke all on function public.complete_account_deletion(text) from public;
grant execute on function public.complete_account_deletion(text) to authenticated;

commit;
