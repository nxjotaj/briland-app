begin;

alter table public."User"
  add column if not exists "representanteId" text null;

alter table public."User"
  drop constraint if exists "User_representanteId_fkey";

alter table public."User"
  add constraint "User_representanteId_fkey"
  foreign key ("representanteId") references public."User"(id)
  on update cascade on delete set null;

create index if not exists "User_representanteId_idx"
on public."User" ("representanteId")
where "representanteId" is not null;

create or replace function public.validate_client_representative_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  representative public."User"%rowtype;
  linked_clients integer;
begin
  if tg_op = 'UPDATE'
     and old.role::text = 'REPRESENTANTE'
     and new.role::text <> 'REPRESENTANTE' then
    select count(*) into linked_clients
    from public."User"
    where "representanteId" = old.id;

    if linked_clients > 0 then
      raise exception using
        errcode = '23514',
        message = format(
          'Este representante atende %s cliente(s). Realoque ou remova esses vínculos antes de alterar o perfil.',
          linked_clients
        );
    end if;
  end if;

  if new."representanteId" is null then
    return new;
  end if;

  if new.role::text <> 'CLIENTE' then
    raise exception using
      errcode = '23514',
      message = 'Somente usuários com perfil CLIENTE podem ser vinculados a um representante.';
  end if;

  if new."representanteId" = new.id then
    raise exception using
      errcode = '23514',
      message = 'Um usuário não pode ser representante de si mesmo.';
  end if;

  select * into representative
  from public."User"
  where id = new."representanteId";

  if not found or representative.role::text <> 'REPRESENTANTE' then
    raise exception using
      errcode = '23514',
      message = 'O responsável selecionado não possui o perfil REPRESENTANTE.';
  end if;

  if representative.status::text <> 'ACTIVE'
     and (tg_op = 'INSERT' or new."representanteId" is distinct from old."representanteId") then
    raise exception using
      errcode = '23514',
      message = 'O representante selecionado está inativo. Escolha um representante ativo.';
  end if;

  return new;
end;
$$;

drop trigger if exists "User_validate_client_representative_link" on public."User";
create trigger "User_validate_client_representative_link"
before insert or update of role, status, "representanteId"
on public."User"
for each row execute function public.validate_client_representative_link();

commit;
